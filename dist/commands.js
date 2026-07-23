import { ensureHostPiTui } from "./host-peers.js";
import { ensureCompatibilityImports, getMcpDiscoverySummary, getServerProvenance, previewCompatibilityImports, previewSharedServerEntry, previewStarterProjectConfig, writeDirectToolsConfig, writeSharedServerEntry, writeStarterProjectConfig } from "./config.js";
import { openPath } from "./utils.js";
import { loadMetadataCache } from "./metadata-cache.js";
import { getAuthForUrl } from "./mcp-auth.js";
import { authenticate, removeAuth, supportsOAuth } from "./mcp-auth-flow.js";
import { buildToolMetadata } from "./tool-metadata.js";
import { getFailureAgeSeconds, lazyConnect, updateMetadataCache, updateStatusBar } from "./init.js";
import { loadOnboardingState, markSetupCompleted, markSharedConfigHintShown } from "./onboarding-state.js";
//#region src/commands.ts
async function showStatus(state, ctx) {
	if (!ctx.hasUI) return;
	const lines = ["MCP Server Status:", ""];
	for (const name of Object.keys(state.config.mcpServers)) {
		const connection = state.manager.getConnection(name);
		const metadata = state.toolMetadata.get(name);
		const toolCount = metadata?.length ?? 0;
		const failedAgo = getFailureAgeSeconds(state, name);
		let status = "not connected";
		let statusIcon = "○";
		let failed = false;
		if (connection?.status === "connected") {
			status = "connected";
			statusIcon = "✓";
		} else if (connection?.status === "needs-auth") {
			status = "needs auth";
			statusIcon = "⚠";
		} else if (failedAgo !== null) {
			status = `failed ${failedAgo}s ago`;
			statusIcon = "✗";
			failed = true;
		} else if (metadata !== void 0) status = "cached";
		const toolSuffix = failed ? "" : ` (${toolCount} tools${status === "cached" ? ", cached" : ""})`;
		lines.push(`${statusIcon} ${name}: ${status}${toolSuffix}`);
	}
	if (Object.keys(state.config.mcpServers).length === 0) {
		lines.push("No MCP servers configured");
		lines.push("Run /mcp setup to adopt imports or scaffold a starter .mcp.json");
	}
	ctx.ui.notify(lines.join("\n"), "info");
}
async function showTools(state, ctx) {
	if (!ctx.hasUI) return;
	const allTools = [...state.toolMetadata.values()].flat().map((m) => m.name);
	if (allTools.length === 0) {
		ctx.ui.notify("No MCP tools available", "info");
		return;
	}
	const lines = [
		"MCP Tools:",
		"",
		...allTools.map((t) => `  ${t}`),
		"",
		`Total: ${allTools.length} tools`
	];
	ctx.ui.notify(lines.join("\n"), "info");
}
async function reconnectServers(state, ctx, targetServer) {
	if (targetServer && !state.config.mcpServers[targetServer]) {
		if (ctx.hasUI) ctx.ui.notify(`Server "${targetServer}" not found in config`, "error");
		return;
	}
	const entries = targetServer ? [[targetServer, state.config.mcpServers[targetServer]]] : Object.entries(state.config.mcpServers);
	for (const [name, definition] of entries) try {
		await state.manager.close(name);
		const connection = await state.manager.connect(name, definition);
		if (connection.status === "needs-auth") {
			if (ctx.hasUI) ctx.ui.notify(`MCP: ${name} requires OAuth. Run /mcp-auth ${name} first.`, "warning");
			continue;
		}
		const prefix = state.config.settings?.toolPrefix ?? "server";
		const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
		state.toolMetadata.set(name, metadata);
		updateMetadataCache(state, name);
		state.failureTracker.delete(name);
		if (ctx.hasUI) {
			ctx.ui.notify(`MCP: Reconnected to ${name} (${connection.tools.length} tools, ${connection.resources.length} resources)`, "info");
			if (failedTools.length > 0) ctx.ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		state.failureTracker.set(name, Date.now());
		if (ctx.hasUI) ctx.ui.notify(`MCP: Failed to reconnect to ${name}: ${message}`, "error");
	}
	updateStatusBar(state);
}
async function authenticateServer(serverName, config, ctx) {
	if (!ctx.hasUI) return {
		ok: false,
		message: "OAuth authentication requires an interactive session."
	};
	const definition = config.mcpServers[serverName];
	if (!definition) {
		const message = `Server "${serverName}" not found in config`;
		ctx.ui.notify(message, "error");
		return {
			ok: false,
			message
		};
	}
	if (!supportsOAuth(definition)) {
		const message = `Server "${serverName}" does not use OAuth authentication. Set "auth": "oauth" or omit auth for auto-detection.`;
		ctx.ui.notify(`Server "${serverName}" does not use OAuth authentication.\nSet "auth": "oauth" or omit auth for auto-detection.`, "error");
		return {
			ok: false,
			message
		};
	}
	if (!definition.url) {
		const message = `Server "${serverName}" has no URL configured (OAuth requires HTTP transport)`;
		ctx.ui.notify(message, "error");
		return {
			ok: false,
			message
		};
	}
	try {
		ctx.ui.setStatus("mcp-auth", `Authenticating ${serverName}...`);
		if (await authenticate(serverName, definition.url, definition, { onAuthorizationUrl: (authorizationUrl) => {
			ctx.ui.notify(`Open this URL to authenticate ${serverName}:\n\n${authorizationUrl}\n\nAfter approving, return to Pi; the local callback will complete automatically.`, "info");
		} }) === "authenticated") {
			const message = `OAuth authentication successful for "${serverName}"! Run /mcp reconnect ${serverName} to connect with the new token.`;
			ctx.ui.notify(`OAuth authentication successful for "${serverName}"!\nRun /mcp reconnect ${serverName} to connect with the new token.`, "info");
			return {
				ok: true,
				message
			};
		}
		const message = `OAuth authentication failed for "${serverName}".`;
		ctx.ui.notify(message, "error");
		return {
			ok: false,
			message
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Failed to authenticate "${serverName}": ${message}`, "error");
		return {
			ok: false,
			message
		};
	} finally {
		ctx.ui.setStatus("mcp-auth", void 0);
	}
}
async function logoutServer(serverName, state, ctx) {
	if (!state.config.mcpServers[serverName]) {
		const message = `Server "${serverName}" not found in config`;
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		return {
			ok: false,
			message
		};
	}
	await removeAuth(serverName);
	await state.manager.close(serverName);
	updateStatusBar(state);
	const message = `OAuth credentials cleared for "${serverName}". Run /mcp-auth ${serverName} to authenticate again.`;
	if (ctx.hasUI) ctx.ui.notify(message, "info");
	return {
		ok: true,
		message
	};
}
function buildSharedConfigNoticeLines(configOverridePath, cwd) {
	const discovery = getMcpDiscoverySummary(configOverridePath, cwd);
	const onboardingState = loadOnboardingState();
	if (!discovery.hasSharedServers || onboardingState.sharedConfigHintShown) return {
		lines: [],
		fingerprint: null
	};
	return {
		lines: [`Using standard MCP config from ${discovery.sources.filter((source) => source.kind === "shared" && source.serverCount > 0).map((source) => source.path).join(", ")}.`, "Pi only writes compatibility imports and adapter-specific overrides into Pi-owned files when needed."],
		fingerprint: discovery.fingerprint
	};
}
async function openMcpSetup(_state, pi, ctx, configOverridePath, mode = "setup") {
	if (!ctx.hasUI) return { configChanged: false };
	const discovery = getMcpDiscoverySummary(configOverridePath, ctx.cwd);
	const onboardingState = loadOnboardingState();
	await ensureHostPiTui();
	const { createMcpSetupPanel } = await import("./mcp-setup-panel.js");
	let configChanged = false;
	const callbacks = {
		previewImports: (imports) => previewCompatibilityImports(imports, configOverridePath),
		previewStarterProject: () => previewStarterProjectConfig(ctx.cwd),
		previewRepoPrompt: () => {
			const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd).repoPrompt;
			if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) return null;
			return previewSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
		},
		adoptImports: async (imports) => {
			const result = ensureCompatibilityImports(imports, configOverridePath);
			if (result.added.length > 0) configChanged = true;
			return result;
		},
		scaffoldProjectConfig: async () => {
			const path = writeStarterProjectConfig(ctx.cwd);
			configChanged = true;
			return { path };
		},
		addRepoPrompt: async () => {
			const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd).repoPrompt;
			if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) throw new Error("RepoPrompt is not available to add from this setup screen.");
			const path = writeSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
			configChanged = true;
			return {
				path,
				serverName: repoPrompt.serverName
			};
		},
		openPath: async (targetPath) => {
			await openPath(pi, targetPath);
		},
		markSetupCompleted: () => {
			markSetupCompleted(discovery.fingerprint);
		}
	};
	return new Promise((resolve) => {
		ctx.ui.custom((tui, _theme, keybindings, done) => {
			return createMcpSetupPanel(discovery, callbacks, {
				mode,
				onboardingState,
				keybindings
			}, tui, () => {
				done(void 0);
				resolve({ configChanged });
			});
		}, {
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: 92
			}
		});
	});
}
function buildMcpPanelCallbacks(state, config, ctx) {
	return {
		reconnect: (serverName) => lazyConnect(state, serverName),
		canAuthenticate: (serverName) => {
			const definition = config.mcpServers[serverName];
			return definition ? supportsOAuth(definition) : false;
		},
		authenticate: (serverName) => authenticateServer(serverName, config, ctx),
		getConnectionStatus: (serverName) => {
			const definition = config.mcpServers[serverName];
			const connection = state.manager.getConnection(serverName);
			if (connection?.status === "needs-auth") return "needs-auth";
			if (definition?.auth === "oauth" && definition.url && definition.oauth !== false && definition.oauth?.grantType !== "client_credentials" && !getAuthForUrl(serverName, definition.url)?.tokens) return "needs-auth";
			if (connection?.status === "connected") return "connected";
			if (getFailureAgeSeconds(state, serverName) !== null) return "failed";
			return "idle";
		},
		refreshCacheAfterReconnect: (serverName) => {
			return loadMetadataCache()?.servers?.[serverName] ?? null;
		}
	};
}
async function openMcpPanel(state, pi, ctx, configOverridePath) {
	if (Object.keys(state.config.mcpServers).length === 0) return openMcpSetup(state, pi, ctx, configOverridePath, "empty");
	const config = state.config;
	const cache = loadMetadataCache();
	const configPath = pi.getFlag("mcp-config") ?? configOverridePath;
	const provenanceMap = getServerProvenance(configPath, ctx.cwd);
	const { lines: noticeLines, fingerprint } = buildSharedConfigNoticeLines(configPath, ctx.cwd);
	const callbacks = buildMcpPanelCallbacks(state, config, ctx);
	await ensureHostPiTui();
	const { createMcpPanel } = await import("./mcp-panel.js");
	let configChanged = false;
	await new Promise((resolve) => {
		ctx.ui.custom((tui, _theme, keybindings, done) => {
			return createMcpPanel(config, cache, provenanceMap, callbacks, tui, (result) => {
				if (!result.cancelled && result.changes.size > 0) {
					writeDirectToolsConfig(result.changes, provenanceMap, config);
					configChanged = true;
					ctx.ui.notify("Direct tools updated. Pi will reload after this panel closes.", "info");
				}
				done(void 0);
				resolve();
			}, {
				noticeLines,
				keybindings
			});
		}, {
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: 82
			}
		});
	});
	if (noticeLines.length > 0 && fingerprint) markSharedConfigHintShown(fingerprint);
	return { configChanged };
}
async function openMcpAuthPanel(state, pi, ctx, configOverridePath) {
	if (!ctx.hasUI) return { configChanged: false };
	const config = state.config;
	if (Object.entries(config.mcpServers).filter(([, definition]) => supportsOAuth(definition)).length === 0) {
		ctx.ui.notify("No OAuth-capable MCP servers are configured.", "warning");
		return { configChanged: false };
	}
	const cache = loadMetadataCache();
	const provenanceMap = getServerProvenance(pi.getFlag("mcp-config") ?? configOverridePath, ctx.cwd);
	const callbacks = buildMcpPanelCallbacks(state, config, ctx);
	await ensureHostPiTui();
	const { createMcpPanel } = await import("./mcp-panel.js");
	await new Promise((resolve) => {
		ctx.ui.custom((tui, _theme, keybindings, done) => {
			return createMcpPanel(config, cache, provenanceMap, callbacks, tui, () => {
				done(void 0);
				resolve();
			}, {
				authOnly: true,
				keybindings,
				noticeLines: ["Select an OAuth MCP server and press Enter or ctrl+a to authenticate."]
			});
		}, {
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: 82
			}
		});
	});
	return { configChanged: false };
}
//#endregion
export { authenticateServer, logoutServer, openMcpAuthPanel, openMcpPanel, openMcpSetup, reconnectServers, showStatus, showTools };
