import { logger } from "./logger.js";
import { UI_STREAM_HOST_CONTEXT_KEY, UI_STREAM_REQUEST_META_KEY, UI_STREAM_STRUCTURED_CONTENT_KEY } from "./ui-stream-types.js";
import { extractUiPromptText } from "./types.js";
import { isGlimpseAvailable, openGlimpseWindow } from "./glimpse-ui.js";
import { randomUUID } from "node:crypto";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
//#region src/ui-session.ts
let activeGlimpseWindow = null;
const MAX_COMPLETED_SESSIONS = 10;
function withStreamEnvelope(result, streamId, sequence) {
	if (!streamId) return result;
	const structuredContent = result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent) ? { ...result.structuredContent } : {};
	const rawEnvelope = structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY];
	structuredContent[UI_STREAM_STRUCTURED_CONTENT_KEY] = {
		...rawEnvelope && typeof rawEnvelope === "object" && !Array.isArray(rawEnvelope) ? { ...rawEnvelope } : {
			frameType: "final",
			phase: "settled",
			status: result.isError ? "error" : "ok"
		},
		streamId,
		sequence
	};
	return {
		...result,
		structuredContent
	};
}
async function openInBrowser(state, url) {
	try {
		await state.openBrowser(url);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		state.ui?.notify(`MCP UI browser open failed: ${message}`, "warning");
		state.ui?.notify(`Open manually: ${url}`, "info");
	}
}
async function maybeStartUiSession(state, request) {
	const log = logger.child({
		component: "UiSession",
		server: request.serverName,
		tool: request.toolName
	});
	try {
		if (state.uiServer && state.uiServer.serverName === request.serverName && state.uiServer.toolName === request.toolName) {
			const existingHandle = state.uiServer;
			const streamMode = request.streamMode;
			const streamId = streamMode ? randomUUID() : void 0;
			const streamToken = streamMode ? randomUUID() : void 0;
			let active = true;
			let nextStreamSequence = 0;
			const cleanupStreamListener = () => {
				if (streamToken) state.manager.removeUiStreamListener(streamToken);
			};
			existingHandle.sendToolInput(request.toolArgs);
			if (streamToken) state.manager.registerUiStreamListener(streamToken, (serverName, notification) => {
				if (!active || state.uiServer !== existingHandle) return;
				if (serverName !== request.serverName) return;
				nextStreamSequence += 1;
				existingHandle.sendResultPatch(withStreamEnvelope(notification.result, streamId, nextStreamSequence));
			});
			return {
				serverName: request.serverName,
				toolName: request.toolName,
				reused: true,
				streamId,
				streamToken,
				streamMode,
				requestMeta: streamToken ? { [UI_STREAM_REQUEST_META_KEY]: streamToken } : void 0,
				url: existingHandle.url,
				isActive: () => active && state.uiServer === existingHandle,
				sendToolResult: (result) => {
					if (!active || state.uiServer !== existingHandle) return;
					nextStreamSequence += 1;
					existingHandle.sendToolResult(withStreamEnvelope(result, streamId, nextStreamSequence));
				},
				sendResultPatch: (result) => {
					if (!active || state.uiServer !== existingHandle) return;
					nextStreamSequence += 1;
					existingHandle.sendResultPatch(withStreamEnvelope(result, streamId, nextStreamSequence));
				},
				sendToolCancelled: (reason) => {
					if (!active || state.uiServer !== existingHandle) return;
					nextStreamSequence += 1;
					existingHandle.sendToolResult(withStreamEnvelope({
						isError: true,
						content: [{
							type: "text",
							text: reason
						}]
					}, streamId, nextStreamSequence));
				},
				close: () => {
					active = false;
					cleanupStreamListener();
				}
			};
		}
		const resource = await state.uiResourceHandler.readUiResource(request.serverName, request.uiResourceUri);
		if (state.uiServer) {
			state.uiServer.close("replaced");
			state.uiServer = null;
		}
		if (activeGlimpseWindow) {
			activeGlimpseWindow.close();
			activeGlimpseWindow = null;
		}
		const streamMode = request.streamMode;
		const streamId = streamMode ? randomUUID() : void 0;
		const streamToken = streamMode ? randomUUID() : void 0;
		const hostContext = streamMode && streamId ? { [UI_STREAM_HOST_CONTEXT_KEY]: {
			mode: streamMode,
			streamId,
			intermediateResultPatches: streamMode === "stream-first",
			partialInput: false
		} } : void 0;
		let active = true;
		let nextStreamSequence = 0;
		let handle = null;
		const cleanupStreamListener = () => {
			if (streamToken) state.manager.removeUiStreamListener(streamToken);
		};
		const { startUiServer } = await import("./ui-server.js");
		handle = await startUiServer({
			serverName: request.serverName,
			toolName: request.toolName,
			toolArgs: streamMode === "stream-first" ? {} : request.toolArgs,
			resource,
			manager: state.manager,
			consentManager: state.consentManager,
			hostContext,
			onMessage: (params) => {
				const prompt = extractUiPromptText(params);
				if (prompt) {
					if (state.sendMessage) {
						state.sendMessage({
							customType: "mcp-ui-prompt",
							content: [{
								type: "text",
								text: `User sent prompt from ${request.serverName} UI: "${prompt}"`
							}],
							display: `💬 UI Prompt: ${prompt}`,
							details: {
								server: request.serverName,
								tool: request.toolName,
								prompt
							}
						}, { triggerTurn: true });
						log.debug("Triggered agent turn for UI prompt", { prompt: prompt.slice(0, 50) });
					}
				} else if (params.type === "intent" || params.intent) {
					const intent = params.intent ?? "";
					const intentParams = params.params;
					if (intent && state.sendMessage) {
						const paramsStr = intentParams ? ` ${JSON.stringify(intentParams)}` : "";
						state.sendMessage({
							customType: "mcp-ui-intent",
							content: [{
								type: "text",
								text: `User triggered intent from ${request.serverName} UI: ${intent}${paramsStr}`
							}],
							display: `🎯 UI Intent: ${intent}`,
							details: {
								server: request.serverName,
								tool: request.toolName,
								intent,
								params: intentParams
							}
						}, { triggerTurn: true });
						log.debug("Triggered agent turn for UI intent", { intent });
					}
				} else if (params.type === "notify" || params.message) {
					const text = params.message ?? "";
					if (text && state.ui) state.ui.notify(`[${request.serverName}] ${text}`, "info");
				}
			},
			onContextUpdate: (params) => {
				log.debug("Model context update from UI", {
					hasContent: !!params.content,
					hasStructured: !!params.structuredContent
				});
			},
			onComplete: (reason) => {
				active = false;
				cleanupStreamListener();
				if (state.uiServer === handle) {
					const messages = handle.getSessionMessages();
					const stream = handle.getStreamSummary();
					if (messages.prompts.length > 0 || messages.intents.length > 0 || messages.notifications.length > 0 || !!stream) {
						state.completedUiSessions.push({
							serverName: handle.serverName,
							toolName: handle.toolName,
							completedAt: /* @__PURE__ */ new Date(),
							reason,
							messages,
							stream
						});
						while (state.completedUiSessions.length > MAX_COMPLETED_SESSIONS) state.completedUiSessions.shift();
						log.debug("Session completed", {
							reason,
							prompts: messages.prompts.length,
							intents: messages.intents.length,
							notifications: messages.notifications.length,
							streamFrames: stream?.frames ?? 0
						});
					}
					state.uiServer = null;
					if (activeGlimpseWindow) {
						activeGlimpseWindow.close();
						activeGlimpseWindow = null;
					}
				}
			}
		});
		if (streamToken) state.manager.registerUiStreamListener(streamToken, (serverName, notification) => {
			if (!active || state.uiServer !== handle) return;
			if (serverName !== request.serverName) return;
			nextStreamSequence += 1;
			handle.sendResultPatch(withStreamEnvelope(notification.result, streamId, nextStreamSequence));
		});
		state.uiServer = handle;
		const glimpseDetected = isGlimpseAvailable();
		const viewerPref = process.env.MCP_UI_VIEWER?.toLowerCase();
		if (viewerPref === "glimpse" || viewerPref !== "browser" && glimpseDetected) try {
			activeGlimpseWindow = await openGlimpseWindow(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${handle.url}"></iframe></body></html>`, {
				title: `MCP · ${request.serverName} · ${request.toolName}`,
				width: 1e3,
				height: 800,
				onClosed: () => {
					if (active) handle.close("glimpse-closed");
				}
			});
		} catch (error) {
			log.debug("Glimpse unavailable, using browser", { error: error instanceof Error ? error.message : String(error) });
			await openInBrowser(state, handle.url);
		}
		else await openInBrowser(state, handle.url);
		return {
			serverName: request.serverName,
			toolName: request.toolName,
			reused: false,
			streamId,
			streamToken,
			streamMode,
			requestMeta: streamToken ? { [UI_STREAM_REQUEST_META_KEY]: streamToken } : void 0,
			url: handle.url,
			isActive: () => active && state.uiServer === handle,
			sendToolResult: (result) => {
				if (!active || state.uiServer !== handle) return;
				nextStreamSequence += 1;
				handle.sendToolResult(withStreamEnvelope(result, streamId, nextStreamSequence));
			},
			sendResultPatch: (result) => {
				if (!active || state.uiServer !== handle) return;
				nextStreamSequence += 1;
				handle.sendResultPatch(withStreamEnvelope(result, streamId, nextStreamSequence));
			},
			sendToolCancelled: (reason) => {
				if (!active || state.uiServer !== handle) return;
				handle.sendToolCancelled(reason);
			},
			close: (reason) => {
				active = false;
				cleanupStreamListener();
				handle.close(reason);
			}
		};
	} catch (error) {
		if (error instanceof UrlElicitationRequiredError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		log.error("Failed to start UI session", error instanceof Error ? error : void 0);
		state.ui?.notify(`MCP UI unavailable for ${request.toolName} (${request.serverName}): ${message}`, "warning");
		return null;
	}
}
//#endregion
export { maybeStartUiSession };
