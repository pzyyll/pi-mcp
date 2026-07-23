import { throwIfAborted } from "./abort.js";
import { loadMcpConfig } from "./config.js";
import { logger } from "./logger.js";
import { ConsentManager } from "./consent-manager.js";
import { McpLifecycleManager } from "./lifecycle.js";
import { openUrl, parallelLimit } from "./utils.js";
import { computeServerHash, getMetadataCachePath, isServerCacheValid, loadMetadataCache, reconstructToolMetadata, saveMetadataCache, serializeResources, serializeTools } from "./metadata-cache.js";
import { McpServerManager } from "./server-manager.js";
import { buildToolMetadata, totalToolCount } from "./tool-metadata.js";
import { UiResourceHandler } from "./ui-resource-handler.js";
import { getMissingConfiguredDirectToolServers } from "./direct-tools-resolve.js";
import "./direct-tools.js";
import { existsSync } from "node:fs";
//#region src/init.ts
const FAILURE_BACKOFF_MS = 60 * 1e3;
function isTuiMode(ctx) {
	return ctx.hasUI && ctx.mode === "tui";
}
async function initializeMcp(pi, ctx) {
	const config = loadMcpConfig(pi.getFlag("mcp-config"), ctx.cwd);
	const manager = new McpServerManager(ctx.cwd);
	manager.setDefaultRequestTimeoutMs(config.settings?.requestTimeoutMs);
	const samplingAutoApprove = config.settings?.samplingAutoApprove === true;
	if (config.settings?.sampling !== false && (ctx.hasUI || samplingAutoApprove)) manager.setSamplingConfig({
		autoApprove: samplingAutoApprove,
		ui: ctx.hasUI ? ctx.ui : void 0,
		modelRegistry: ctx.modelRegistry,
		getCurrentModel: () => ctx.model,
		getSignal: () => ctx.signal
	});
	if (config.settings?.elicitation !== false && ctx.hasUI) manager.setElicitationConfig({
		ui: ctx.ui,
		allowUrl: isTuiMode(ctx)
	});
	const lifecycle = new McpLifecycleManager(manager);
	const toolMetadata = /* @__PURE__ */ new Map();
	const state = {
		manager,
		lifecycle,
		toolMetadata,
		config,
		failureTracker: /* @__PURE__ */ new Map(),
		uiResourceHandler: new UiResourceHandler(manager),
		consentManager: new ConsentManager("once-per-server"),
		uiServer: null,
		completedUiSessions: [],
		openBrowser: (url) => openUrl(pi, url, process.env.BROWSER),
		ui: ctx.hasUI ? ctx.ui : void 0,
		sendMessage: (message, options) => pi.sendMessage(message, options)
	};
	const serverEntries = Object.entries(config.mcpServers);
	if (serverEntries.length === 0) return state;
	const idleSetting = typeof config.settings?.idleTimeout === "number" ? config.settings.idleTimeout : 10;
	lifecycle.setGlobalIdleTimeout(idleSetting);
	const cacheFileExists = existsSync(getMetadataCachePath());
	let cache = loadMetadataCache();
	let bootstrapAll = false;
	if (!cacheFileExists) {
		bootstrapAll = true;
		saveMetadataCache({
			version: 1,
			servers: {}
		});
	} else if (!cache) {
		cache = {
			version: 1,
			servers: {}
		};
		saveMetadataCache(cache);
	}
	const prefix = config.settings?.toolPrefix ?? "server";
	for (const [name, definition] of serverEntries) {
		const lifecycleMode = definition.lifecycle ?? "lazy";
		const idleOverride = definition.idleTimeout ?? (lifecycleMode === "eager" ? 0 : void 0);
		lifecycle.registerServer(name, definition, idleOverride !== void 0 ? { idleTimeout: idleOverride } : void 0);
		if (lifecycleMode === "keep-alive") lifecycle.markKeepAlive(name, definition);
		if (cache?.servers?.[name] && isServerCacheValid(cache.servers[name], definition)) {
			const metadata = reconstructToolMetadata(name, cache.servers[name], prefix, definition);
			toolMetadata.set(name, metadata);
		}
	}
	const startupServers = bootstrapAll ? serverEntries : serverEntries.filter(([, definition]) => {
		const mode = definition.lifecycle ?? "lazy";
		return mode === "keep-alive" || mode === "eager";
	});
	if (ctx.hasUI && startupServers.length > 0) ctx.ui.setStatus("mcp", `MCP: connecting to ${startupServers.length} servers...`);
	const results = await parallelLimit(startupServers, 10, async ([name, definition]) => {
		try {
			const connection = await manager.connect(name, definition, ctx.signal);
			if (connection.status === "needs-auth") return {
				name,
				definition,
				connection: null,
				error: `OAuth authentication required. Run /mcp-auth ${name}.`
			};
			return {
				name,
				definition,
				connection,
				error: null
			};
		} catch (error) {
			return {
				name,
				definition,
				connection: null,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	});
	for (const { name, definition, connection, error } of results) {
		if (error || !connection) {
			if (ctx.hasUI) ctx.ui.notify(`MCP: Failed to connect to ${name}: ${error}`, "error");
			console.error(`MCP: Failed to connect to ${name}: ${error}`);
			continue;
		}
		const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
		toolMetadata.set(name, metadata);
		updateMetadataCache(state, name);
		if (failedTools.length > 0 && ctx.hasUI) ctx.ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
	}
	const connectedCount = results.filter((r) => r.connection).length;
	const failedCount = results.filter((r) => r.error).length;
	if (ctx.hasUI && connectedCount > 0) {
		const totalTools = totalToolCount(state);
		const msg = failedCount > 0 ? `MCP: ${connectedCount}/${startupServers.length} servers connected (${totalTools} tools)` : `MCP: ${connectedCount} servers connected (${totalTools} tools)`;
		ctx.ui.notify(msg, "info");
	}
	if (process.env.MCP_DIRECT_TOOLS !== "__none__") {
		const missingCacheServers = getMissingConfiguredDirectToolServers(config, loadMetadataCache());
		if (missingCacheServers.length > 0) {
			const bootstrapped = (await parallelLimit(missingCacheServers.filter((name) => !results.some((r) => r.name === name && r.connection)), 10, async (name) => {
				const definition = config.mcpServers[name];
				try {
					const connection = await manager.connect(name, definition, ctx.signal);
					if (connection.status === "needs-auth") return {
						name,
						ok: false
					};
					const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
					toolMetadata.set(name, metadata);
					updateMetadataCache(state, name);
					return {
						name,
						ok: true
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logger.debug(`MCP: direct-tools bootstrap failed for ${name}: ${message}`);
					return {
						name,
						ok: false
					};
				}
			})).filter((r) => r.ok).map((r) => r.name);
			if (bootstrapped.length > 0 && ctx.hasUI) ctx.ui.notify(`MCP: direct tools for ${bootstrapped.join(", ")} will be available after restart`, "info");
		}
	}
	lifecycle.setReconnectCallback((serverName) => {
		updateServerMetadata(state, serverName);
		updateMetadataCache(state, serverName);
		state.failureTracker.delete(serverName);
		updateStatusBar(state);
	});
	lifecycle.setIdleShutdownCallback((serverName) => {
		const idleMinutes = getEffectiveIdleTimeoutMinutes(state, serverName);
		logger.debug(`${serverName} shut down (idle ${idleMinutes}m)`);
		updateStatusBar(state);
	});
	lifecycle.startHealthChecks();
	return state;
}
function updateServerMetadata(state, serverName) {
	const connection = state.manager.getConnection(serverName);
	if (!connection || connection.status !== "connected") return;
	const definition = state.config.mcpServers[serverName];
	if (!definition) return;
	const prefix = state.config.settings?.toolPrefix ?? "server";
	const { metadata } = buildToolMetadata(connection.tools, connection.resources, definition, serverName, prefix);
	state.toolMetadata.set(serverName, metadata);
}
function updateMetadataCache(state, serverName) {
	const connection = state.manager.getConnection(serverName);
	if (!connection || connection.status !== "connected") return;
	const definition = state.config.mcpServers[serverName];
	if (!definition) return;
	const configHash = computeServerHash(definition);
	const existingEntry = loadMetadataCache()?.servers?.[serverName];
	const tools = serializeTools(connection.tools);
	let resources = definition.exposeResources === false ? [] : serializeResources(connection.resources);
	if (definition.exposeResources !== false && resources.length === 0 && existingEntry?.resources?.length && existingEntry.configHash === configHash) resources = existingEntry.resources;
	const entry = {
		configHash,
		tools,
		resources,
		cachedAt: Date.now()
	};
	saveMetadataCache({
		version: 1,
		servers: { [serverName]: entry }
	});
}
function flushMetadataCache(state) {
	for (const [name, connection] of state.manager.getAllConnections()) if (connection.status === "connected") updateMetadataCache(state, name);
}
function updateStatusBar(state) {
	const ui = state.ui;
	if (!ui) return;
	const total = Object.keys(state.config.mcpServers).length;
	if (total === 0) {
		ui.setStatus("mcp", void 0);
		return;
	}
	const connectedCount = state.manager.getAllConnections().size;
	ui.setStatus("mcp", ui.theme.fg("accent", `MCP: ${connectedCount}/${total} servers`));
}
function getFailureAgeSeconds(state, serverName) {
	const failedAt = state.failureTracker.get(serverName);
	if (!failedAt) return null;
	const ageMs = Date.now() - failedAt;
	if (ageMs > FAILURE_BACKOFF_MS) return null;
	return Math.round(ageMs / 1e3);
}
async function lazyConnect(state, serverName, signal) {
	const connection = state.manager.getConnection(serverName);
	if (connection?.status === "needs-auth") return false;
	if (connection?.status === "connected") {
		updateServerMetadata(state, serverName);
		return true;
	}
	if (getFailureAgeSeconds(state, serverName) !== null) return false;
	const definition = state.config.mcpServers[serverName];
	if (!definition) return false;
	try {
		if (state.ui) state.ui.setStatus("mcp", `MCP: connecting to ${serverName}...`);
		if ((await state.manager.connect(serverName, definition, signal)).status === "needs-auth") return false;
		state.failureTracker.delete(serverName);
		updateServerMetadata(state, serverName);
		updateMetadataCache(state, serverName);
		updateStatusBar(state);
		return true;
	} catch (error) {
		if (signal?.aborted) throwIfAborted(signal);
		state.failureTracker.set(serverName, Date.now());
		const message = error instanceof Error ? error.message : String(error);
		logger.debug(`MCP: lazy connect failed for ${serverName}: ${message}`);
		updateStatusBar(state);
		return false;
	}
}
function getEffectiveIdleTimeoutMinutes(state, serverName) {
	const definition = state.config.mcpServers[serverName];
	if (!definition) return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
	if (typeof definition.idleTimeout === "number") return definition.idleTimeout;
	if ((definition.lifecycle ?? "lazy") === "eager") return 0;
	return typeof state.config.settings?.idleTimeout === "number" ? state.config.settings.idleTimeout : 10;
}
//#endregion
export { flushMetadataCache, getFailureAgeSeconds, initializeMcp, isTuiMode, lazyConnect, updateMetadataCache, updateServerMetadata, updateStatusBar };
