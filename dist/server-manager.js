import { abortable, throwIfAborted } from "./abort.js";
import { logger } from "./logger.js";
import { serverStreamResultPatchNotificationSchema } from "./ui-stream-types.js";
import "./types.js";
import { interpolateEnvRecord, resolveBearerToken, resolveConfigPath } from "./utils.js";
import { resolveNpxBinary } from "./npx-resolver.js";
import { McpOAuthProvider } from "./mcp-oauth-provider.js";
import { extractOAuthConfig, supportsOAuth } from "./mcp-auth-flow.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { ElicitationCompleteNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
//#region src/server-manager.ts
var McpServerManager = class {
	defaultCwd;
	connections = /* @__PURE__ */ new Map();
	connectPromises = /* @__PURE__ */ new Map();
	uiStreamListeners = /* @__PURE__ */ new Map();
	samplingConfig;
	elicitationConfig;
	acceptedUrlElicitations = /* @__PURE__ */ new Map();
	defaultRequestTimeoutMs;
	/** Default cwd for stdio servers without an explicit config `cwd`. */
	constructor(defaultCwd) {
		this.defaultCwd = defaultCwd;
	}
	setSamplingConfig(config) {
		this.samplingConfig = config;
	}
	setElicitationConfig(config) {
		this.elicitationConfig = config;
	}
	setDefaultRequestTimeoutMs(timeoutMs) {
		this.defaultRequestTimeoutMs = normalizeRequestTimeoutMs(timeoutMs);
	}
	getRequestOptions(name, signal) {
		const connection = this.connections.get(name);
		return this.buildRequestOptions(connection?.definition, signal);
	}
	getResolvedRequestTimeoutMs(definition) {
		if (definition?.requestTimeoutMs !== void 0) return normalizeRequestTimeoutMs(definition.requestTimeoutMs);
		return this.defaultRequestTimeoutMs;
	}
	buildRequestOptions(definition, signal) {
		const timeout = this.getResolvedRequestTimeoutMs(definition);
		if (!signal && timeout === void 0) return;
		return {
			...signal ? { signal } : {},
			...timeout !== void 0 ? { timeout } : {}
		};
	}
	async connect(name, definition, signal) {
		throwIfAborted(signal);
		if (this.connectPromises.has(name)) return abortable(this.connectPromises.get(name), signal);
		const existing = this.connections.get(name);
		if (existing?.status === "connected") {
			existing.lastUsedAt = Date.now();
			return existing;
		}
		const promise = this.createConnection(name, definition, signal);
		this.connectPromises.set(name, promise);
		try {
			const connection = await promise;
			this.connections.set(name, connection);
			return connection;
		} finally {
			this.connectPromises.delete(name);
		}
	}
	async createConnection(name, definition, signal) {
		throwIfAborted(signal);
		const client = await this.createClient(name);
		let transport;
		if (definition.command) {
			let command = definition.command;
			let args = definition.args ?? [];
			if (command === "npx" || command === "npm") {
				const resolved = await resolveNpxBinary(command, args);
				if (resolved) {
					command = resolved.isJs ? "node" : resolved.binPath;
					args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
					logger.debug(`${name} resolved to ${resolved.binPath} (skipping npm parent)`);
				}
			}
			transport = new StdioClientTransport({
				command,
				args,
				env: resolveEnv(definition.env),
				cwd: resolveConfigPath(definition.cwd) ?? this.defaultCwd,
				stderr: definition.debug ? "inherit" : "ignore"
			});
		} else if (definition.url) transport = await this.createHttpTransport(definition, name, signal);
		else throw new Error(`Server ${name} has no command or url`);
		const requestOptions = this.buildRequestOptions(definition, signal);
		try {
			await client.connect(transport, requestOptions);
			this.attachAdapterNotificationHandlers(name, client);
			const [tools, resources] = await Promise.all([this.fetchAllTools(client, requestOptions), this.fetchAllResources(client, requestOptions)]);
			return {
				client,
				transport,
				definition,
				tools,
				resources,
				lastUsedAt: Date.now(),
				inFlight: 0,
				status: "connected"
			};
		} catch (error) {
			if (error instanceof UnauthorizedError && supportsOAuth(definition)) {
				await client.close().catch(() => {});
				await transport.close().catch(() => {});
				return {
					client,
					transport,
					definition,
					tools: [],
					resources: [],
					lastUsedAt: Date.now(),
					inFlight: 0,
					status: "needs-auth"
				};
			}
			await client.close().catch(() => {});
			await transport.close().catch(() => {});
			throw error;
		}
	}
	buildClientCapabilities() {
		return {
			...this.samplingConfig ? { sampling: {} } : {},
			...this.elicitationConfig ? { elicitation: {
				form: {},
				...this.elicitationConfig.allowUrl ? { url: {} } : {}
			} } : {}
		};
	}
	async createClient(serverName) {
		const capabilities = this.buildClientCapabilities();
		const client = new Client({
			name: `pi-mcp-${serverName}`,
			version: "1.0.0"
		}, Object.keys(capabilities).length > 0 ? { capabilities } : void 0);
		if (this.samplingConfig) {
			const { registerSamplingHandler } = await import("./sampling-handler.js");
			registerSamplingHandler(client, {
				...this.samplingConfig,
				serverName
			});
		}
		if (this.elicitationConfig) {
			const { registerElicitationHandler } = await import("./elicitation-handler.js");
			registerElicitationHandler(client, {
				...this.elicitationConfig,
				serverName,
				onUrlAccepted: (elicitationId) => this.rememberUrlElicitation(serverName, elicitationId)
			});
			if (this.elicitationConfig.allowUrl) client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
				if (!this.acceptedUrlElicitations.get(serverName)?.delete(notification.params.elicitationId)) return;
				this.elicitationConfig?.ui.notify(`MCP browser interaction for ${serverName} completed. You can retry the tool now.`, "info");
			});
		}
		return client;
	}
	async handleUrlElicitationRequired(serverName, error) {
		if (!this.elicitationConfig?.allowUrl) return "cancel";
		const { handleUrlElicitation } = await import("./elicitation-handler.js");
		for (const params of error.elicitations) {
			const result = await handleUrlElicitation({
				...this.elicitationConfig,
				serverName,
				onUrlAccepted: (elicitationId) => this.rememberUrlElicitation(serverName, elicitationId)
			}, params);
			if (result.action !== "accept") return result.action;
		}
		return "accept";
	}
	rememberUrlElicitation(serverName, elicitationId) {
		let accepted = this.acceptedUrlElicitations.get(serverName);
		if (!accepted) {
			accepted = /* @__PURE__ */ new Set();
			this.acceptedUrlElicitations.set(serverName, accepted);
		}
		accepted.add(elicitationId);
	}
	async createHttpTransport(definition, serverName, signal) {
		throwIfAborted(signal);
		const url = new URL(definition.url);
		const headers = resolveHeaders(definition.headers) ?? {};
		if (definition.auth === "bearer") {
			const token = resolveBearerToken(definition);
			if (token) headers["Authorization"] = `Bearer ${token}`;
		}
		const requestInit = Object.keys(headers).length > 0 ? { headers } : void 0;
		let authProvider;
		if (supportsOAuth(definition)) {
			const oauthConfig = extractOAuthConfig(definition);
			authProvider = new McpOAuthProvider(serverName, definition.url, oauthConfig, { onRedirect: async (_authUrl) => {} });
		}
		const streamableTransport = new StreamableHTTPClientTransport(url, {
			requestInit,
			authProvider
		});
		try {
			const testClient = new Client({
				name: "pi-mcp-probe",
				version: "2.1.2"
			});
			await testClient.connect(streamableTransport, this.buildRequestOptions(definition, signal));
			await testClient.close().catch(() => {});
			await streamableTransport.close().catch(() => {});
			return new StreamableHTTPClientTransport(url, {
				requestInit,
				authProvider
			});
		} catch (error) {
			await streamableTransport.close().catch(() => {});
			if (signal?.aborted) throwIfAborted(signal);
			if (error instanceof UnauthorizedError) throw error;
			return new SSEClientTransport(url, {
				requestInit,
				authProvider
			});
		}
	}
	async fetchAllTools(client, requestOptions) {
		const allTools = [];
		let cursor;
		do {
			const result = await client.listTools(cursor ? { cursor } : void 0, requestOptions);
			allTools.push(...result.tools ?? []);
			cursor = result.nextCursor;
		} while (cursor);
		return allTools;
	}
	async fetchAllResources(client, requestOptions) {
		try {
			const allResources = [];
			let cursor;
			do {
				const result = await client.listResources(cursor ? { cursor } : void 0, requestOptions);
				allResources.push(...result.resources ?? []);
				cursor = result.nextCursor;
			} while (cursor);
			return allResources;
		} catch {
			if (requestOptions?.signal?.aborted) throwIfAborted(requestOptions.signal);
			return [];
		}
	}
	attachAdapterNotificationHandlers(serverName, client) {
		client.setNotificationHandler(serverStreamResultPatchNotificationSchema, (notification) => {
			const listener = this.uiStreamListeners.get(notification.params.streamToken);
			if (!listener) return;
			listener(serverName, notification.params);
		});
	}
	registerUiStreamListener(streamToken, listener) {
		this.uiStreamListeners.set(streamToken, listener);
	}
	removeUiStreamListener(streamToken) {
		this.uiStreamListeners.delete(streamToken);
	}
	async readResource(name, uri, signal) {
		const connection = this.connections.get(name);
		if (!connection || connection.status !== "connected") throw new Error(`Server "${name}" is not connected`);
		try {
			this.touch(name);
			this.incrementInFlight(name);
			return await connection.client.readResource({ uri }, this.getRequestOptions(name, signal));
		} finally {
			this.decrementInFlight(name);
			this.touch(name);
		}
	}
	async close(name) {
		const connection = this.connections.get(name);
		if (!connection) return;
		connection.status = "closed";
		this.connections.delete(name);
		this.acceptedUrlElicitations.delete(name);
		await connection.client.close().catch(() => {});
		await connection.transport.close().catch(() => {});
	}
	async closeAll() {
		const names = [...this.connections.keys()];
		await Promise.all(names.map((name) => this.close(name)));
	}
	getConnection(name) {
		return this.connections.get(name);
	}
	getAllConnections() {
		return new Map(this.connections);
	}
	touch(name) {
		const connection = this.connections.get(name);
		if (connection) connection.lastUsedAt = Date.now();
	}
	incrementInFlight(name) {
		const connection = this.connections.get(name);
		if (connection) connection.inFlight = (connection.inFlight ?? 0) + 1;
	}
	decrementInFlight(name) {
		const connection = this.connections.get(name);
		if (connection && connection.inFlight) connection.inFlight--;
	}
	isIdle(name, timeoutMs) {
		const connection = this.connections.get(name);
		if (!connection || connection.status !== "connected") return false;
		if (connection.inFlight > 0) return false;
		return Date.now() - connection.lastUsedAt > timeoutMs;
	}
};
/**
* Resolve environment variables with interpolation.
*/
function resolveEnv(env) {
	const resolved = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== void 0) resolved[key] = value;
	if (!env) return resolved;
	const overrides = interpolateEnvRecord(env);
	return overrides ? {
		...resolved,
		...overrides
	} : resolved;
}
/**
* Resolve headers with environment variable interpolation.
*/
function resolveHeaders(headers) {
	return interpolateEnvRecord(headers);
}
function normalizeRequestTimeoutMs(timeoutMs) {
	return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : void 0;
}
//#endregion
export { McpServerManager };
