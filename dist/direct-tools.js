import { abortable, throwIfAborted } from "./abort.js";
import { formatAuthRequiredMessage } from "./utils.js";
import { authenticate, supportsOAuth } from "./mcp-auth-flow.js";
import { formatSchema } from "./schema-format.js";
import { resolveMcpResultContent, transformMcpContent } from "./tool-registrar.js";
import { guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions } from "./mcp-output-guard.js";
import { maybeStartUiSession } from "./ui-session.js";
import { buildProxyDescription, getMissingConfiguredDirectToolServers, resolveDirectTools } from "./direct-tools-resolve.js";
import { getFailureAgeSeconds, lazyConnect } from "./init.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
//#region src/direct-tools.ts
function getDirectAuthRequiredMessage(state, serverName, defaultMessage = `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`) {
	return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
function getDirectAuthFailedMessage(state, serverName, message) {
	if (state.config.settings?.authRequiredMessage) return `OAuth authentication failed for "${serverName}": ${message}. ${getDirectAuthRequiredMessage(state, serverName)}`;
	return `OAuth authentication failed for "${serverName}": ${message}. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`;
}
async function attemptDirectAutoAuth(state, serverName) {
	if (state.config.settings?.autoAuth !== true) return { status: "skipped" };
	const definition = state.config.mcpServers[serverName];
	if (!definition || !supportsOAuth(definition) || !definition.url) return { status: "skipped" };
	const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
	if (!state.ui && grantType !== "client_credentials") return {
		status: "failed",
		message: getDirectAuthRequiredMessage(state, serverName, `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`)
	};
	try {
		await authenticate(serverName, definition.url, definition);
		return { status: "success" };
	} catch (error) {
		return {
			status: "failed",
			message: getDirectAuthFailedMessage(state, serverName, error instanceof Error ? error.message : String(error))
		};
	}
}
function createDirectToolExecutor(getState, getInitPromise, spec) {
	return async function execute(_toolCallId, params, signal) {
		throwIfAborted(signal);
		let state = getState();
		const initPromise = getInitPromise();
		if (!state && initPromise) try {
			state = await initPromise;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{
					type: "text",
					text: `MCP initialization failed: ${message}`
				}],
				details: {
					error: "init_failed",
					message
				}
			};
		}
		if (!state) return {
			content: [{
				type: "text",
				text: "MCP not initialized"
			}],
			details: { error: "not_initialized" }
		};
		let connected = await lazyConnect(state, spec.serverName, signal);
		let autoAuthAttempted = false;
		if (!connected && state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
			autoAuthAttempted = true;
			const autoAuth = await attemptDirectAutoAuth(state, spec.serverName);
			if (autoAuth.status === "failed") return {
				content: [{
					type: "text",
					text: autoAuth.message
				}],
				details: {
					error: "auth_required",
					server: spec.serverName,
					message: autoAuth.message
				}
			};
			if (autoAuth.status === "success") {
				await state.manager.close(spec.serverName);
				state.failureTracker.delete(spec.serverName);
				connected = await lazyConnect(state, spec.serverName, signal);
			}
		}
		if (!connected) {
			if (state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
				const message = getDirectAuthRequiredMessage(state, spec.serverName);
				return {
					content: [{
						type: "text",
						text: message
					}],
					details: {
						error: "auth_required",
						server: spec.serverName,
						message,
						autoAuthAttempted
					}
				};
			}
			const failedAgo = getFailureAgeSeconds(state, spec.serverName);
			return {
				content: [{
					type: "text",
					text: `MCP server "${spec.serverName}" not available${failedAgo !== null ? ` (failed ${failedAgo}s ago)` : ""}`
				}],
				details: {
					error: "server_unavailable",
					server: spec.serverName
				}
			};
		}
		const connection = state.manager.getConnection(spec.serverName);
		if (!connection || connection.status !== "connected") return {
			content: [{
				type: "text",
				text: `MCP server "${spec.serverName}" not connected`
			}],
			details: {
				error: "not_connected",
				server: spec.serverName
			}
		};
		let uiSession = null;
		const requestOptions = state.manager.getRequestOptions?.(spec.serverName, signal) ?? (signal ? { signal } : void 0);
		const outputGuardOptions = resolveMcpOutputGuardOptions(state.config.settings);
		try {
			state.manager.touch(spec.serverName);
			state.manager.incrementInFlight(spec.serverName);
			if (spec.resourceUri) {
				const content = ((await connection.client.readResource({ uri: spec.resourceUri }, requestOptions)).contents ?? []).map((c) => ({
					type: "text",
					text: "text" in c ? c.text : "blob" in c ? `[Binary data: ${c.mimeType ?? "unknown"}]` : JSON.stringify(c)
				}));
				const guarded = await guardMcpOutput(content.length > 0 ? content : [{
					type: "text",
					text: "(empty resource)"
				}], outputGuardOptions);
				return {
					content: guarded.content,
					details: {
						server: spec.serverName,
						resourceUri: spec.resourceUri,
						...guardedMcpDetails(guarded)
					}
				};
			}
			const hasUi = !!spec.uiResourceUri;
			uiSession = hasUi ? await maybeStartUiSession(state, {
				serverName: spec.serverName,
				toolName: spec.originalName,
				toolArgs: params ?? {},
				uiResourceUri: spec.uiResourceUri,
				streamMode: spec.uiStreamMode
			}) : null;
			const result = await abortable(connection.client.callTool({
				name: spec.originalName,
				arguments: params ?? {},
				_meta: uiSession?.requestMeta
			}, void 0, requestOptions), signal);
			uiSession?.sendToolResult(result);
			if (result.isError) {
				const content = transformMcpContent(result.content ?? []);
				const outputContent = content.length > 0 ? content : [{
					type: "text",
					text: "(empty result)"
				}];
				const schemaText = spec.inputSchema ? `\n\nExpected parameters:\n${formatSchema(spec.inputSchema)}` : "";
				const guarded = await guardMcpOutput(outputContent, {
					...outputGuardOptions,
					prefix: "Error: ",
					suffix: schemaText,
					emptyTextFallback: "Tool execution failed"
				});
				return {
					content: guarded.content,
					details: {
						error: "tool_error",
						server: spec.serverName,
						...guardedMcpDetails(guarded)
					}
				};
			}
			const content = resolveMcpResultContent(result);
			const outputContent = content.length > 0 ? content : [{
				type: "text",
				text: "(empty result)"
			}];
			if (hasUi) {
				const uiMessage = uiSession?.reused ? "Updated the open UI." : "📺 Interactive UI is now open in your browser. I'll respond to your prompts and intents as you interact with it.";
				const guarded = await guardMcpOutput(outputContent, {
					...outputGuardOptions,
					suffix: `\n\n${uiMessage}`
				});
				return {
					content: guarded.content,
					details: {
						server: spec.serverName,
						tool: spec.originalName,
						uiOpen: true,
						...guardedMcpDetails(guarded)
					}
				};
			}
			const guarded = await guardMcpOutput(outputContent, { ...outputGuardOptions });
			return {
				content: guarded.content,
				details: {
					server: spec.serverName,
					tool: spec.originalName,
					...guardedMcpDetails(guarded)
				}
			};
		} catch (error) {
			if (error instanceof UrlElicitationRequiredError) {
				const action = await state.manager.handleUrlElicitationRequired(spec.serverName, error);
				const message = action === "accept" ? "The original MCP tool did not run. Complete the opened browser interaction, then retry the tool." : `The URL interaction was ${action === "decline" ? "declined" : "cancelled"}.`;
				uiSession?.sendToolCancelled(message);
				return {
					content: [{
						type: "text",
						text: message
					}],
					details: {
						error: "url_elicitation_required",
						server: spec.serverName,
						action
					}
				};
			}
			const message = error instanceof Error ? error.message : String(error);
			uiSession?.sendToolCancelled(message);
			const schemaText = spec.inputSchema ? `\n\nExpected parameters:\n${formatSchema(spec.inputSchema)}` : "";
			const guarded = await guardMcpOutput([{
				type: "text",
				text: message
			}], {
				...outputGuardOptions,
				prefix: "Failed to call tool: ",
				suffix: schemaText
			});
			return {
				content: guarded.content,
				details: {
					error: "call_failed",
					server: spec.serverName,
					...guardedMcpDetails(guarded)
				}
			};
		} finally {
			if (uiSession?.reused) uiSession.close();
			state.manager.decrementInFlight(spec.serverName);
			state.manager.touch(spec.serverName);
		}
	};
}
//#endregion
export { buildProxyDescription, createDirectToolExecutor, getMissingConfiguredDirectToolServers, resolveDirectTools };
