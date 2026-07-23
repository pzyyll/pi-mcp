import { t as getAgentPath } from "./agent-dir.js";
import "node:module";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import open from "open";
import { createServer } from "http";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/mcp-auth.ts
/**
* MCP Auth Storage Module
*
* Handles secure storage of OAuth credentials, tokens, client information,
* and PKCE state for MCP servers.
*
* Token storage location: $MCP_OAUTH_DIR/sha256-<server-hash>/tokens.json when set,
* otherwise <Pi agent dir>/mcp-oauth/sha256-<server-hash>/tokens.json
*/
function getAuthBaseDir() {
	const override = process.env.MCP_OAUTH_DIR?.trim();
	return override ? override : getAgentPath("mcp-oauth");
}
/**
* Get the server-specific directory path.
*/
function getServerDir(serverName) {
	if (typeof serverName !== "string") throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
	const storageKey = createHash("sha256").update(serverName, "utf8").digest("hex");
	return join(getAuthBaseDir(), `sha256-${storageKey}`);
}
/**
* Get the tokens file path for a server.
*/
function getAuthEntryFilePath(serverName) {
	return join(getServerDir(serverName), "tokens.json");
}
/**
* Ensure the server directory exists with secure permissions.
*/
function ensureServerDir(serverName) {
	const dir = getServerDir(serverName);
	if (!existsSync(dir)) mkdirSync(dir, {
		recursive: true,
		mode: 448
	});
}
/**
* Read the auth entry for a server from disk.
* Returns undefined if file doesn't exist.
*/
function readAuthEntry(serverName) {
	const filePath = getAuthEntryFilePath(serverName);
	try {
		if (!existsSync(filePath)) return;
		const data = readFileSync(filePath, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		console.error(`Failed to read auth entry for ${serverName}:`, error);
		return;
	}
}
/**
* Write the auth entry for a server to disk with secure permissions.
*/
function writeAuthEntry(serverName, entry) {
	ensureServerDir(serverName);
	writeFileSync(getAuthEntryFilePath(serverName), JSON.stringify(entry, null, 2), { mode: 384 });
}
/**
* Get auth entry for a server.
*/
function getAuthEntry(serverName) {
	return readAuthEntry(serverName);
}
/**
* Get auth entry and validate it's for the correct URL.
* Returns undefined if URL has changed (credentials are invalid).
*/
function getAuthForUrl(serverName, serverUrl) {
	const entry = getAuthEntry(serverName);
	if (!entry) return void 0;
	if (!entry.serverUrl) return void 0;
	if (entry.serverUrl !== serverUrl) return void 0;
	return entry;
}
/**
* Save auth entry for a server.
*/
function saveAuthEntry(serverName, entry, serverUrl) {
	if (serverUrl) entry.serverUrl = serverUrl;
	writeAuthEntry(serverName, entry);
}
/**
* Remove auth entry for a server.
* Also removes the server directory if empty.
*/
function removeAuthEntry(serverName) {
	try {
		const filePath = getAuthEntryFilePath(serverName);
		if (existsSync(filePath)) writeFileSync(filePath, "{}", { mode: 384 });
		const dir = getServerDir(serverName);
		if (existsSync(dir)) try {
			rmSync(dir, { recursive: true });
		} catch {}
	} catch (error) {
		console.error(`Failed to remove auth entry for ${serverName}:`, error);
	}
}
/**
* Update tokens for a server.
*/
function updateTokens(serverName, tokens, serverUrl) {
	const entry = getAuthEntry(serverName) ?? {};
	if (serverUrl && entry.serverUrl !== serverUrl) {
		delete entry.clientInfo;
		delete entry.codeVerifier;
		delete entry.oauthState;
	}
	entry.tokens = tokens;
	saveAuthEntry(serverName, entry, serverUrl);
}
/**
* Update client info for a server.
*/
function updateClientInfo(serverName, clientInfo, serverUrl) {
	const entry = getAuthEntry(serverName) ?? {};
	if (serverUrl && entry.serverUrl !== serverUrl) {
		delete entry.tokens;
		delete entry.codeVerifier;
		delete entry.oauthState;
	}
	entry.clientInfo = clientInfo;
	saveAuthEntry(serverName, entry, serverUrl);
}
/**
* Update code verifier for a server.
*/
function updateCodeVerifier(serverName, codeVerifier, serverUrl) {
	const entry = getAuthEntry(serverName) ?? {};
	if (serverUrl && entry.serverUrl !== serverUrl) {
		delete entry.tokens;
		delete entry.clientInfo;
		delete entry.oauthState;
	}
	entry.codeVerifier = codeVerifier;
	saveAuthEntry(serverName, entry, serverUrl);
}
/**
* Clear code verifier for a server.
*/
function clearCodeVerifier(serverName) {
	const entry = getAuthEntry(serverName);
	if (entry) {
		delete entry.codeVerifier;
		saveAuthEntry(serverName, entry);
	}
}
/**
* Update OAuth state for a server.
*/
function updateOAuthState(serverName, state, serverUrl) {
	const entry = getAuthEntry(serverName) ?? {};
	if (serverUrl && entry.serverUrl !== serverUrl) {
		delete entry.tokens;
		delete entry.clientInfo;
		delete entry.codeVerifier;
	}
	entry.oauthState = state;
	saveAuthEntry(serverName, entry, serverUrl);
}
/**
* Get OAuth state for a server.
*/
function getOAuthState(serverName) {
	return getAuthEntry(serverName)?.oauthState;
}
/**
* Clear OAuth state for a server.
*/
function clearOAuthState(serverName) {
	const entry = getAuthEntry(serverName);
	if (entry) {
		delete entry.oauthState;
		saveAuthEntry(serverName, entry);
	}
}
/**
* Clear all credentials for a server.
*/
function clearAllCredentials(serverName) {
	removeAuthEntry(serverName);
}
/**
* Clear only client info for a server.
*/
function clearClientInfo(serverName) {
	const entry = getAuthEntry(serverName);
	if (entry) {
		delete entry.clientInfo;
		saveAuthEntry(serverName, entry);
	}
}
/**
* Clear only tokens for a server.
*/
function clearTokens(serverName) {
	const entry = getAuthEntry(serverName);
	if (entry) {
		delete entry.tokens;
		saveAuthEntry(serverName, entry);
	}
}
//#endregion
//#region src/mcp-oauth-provider.ts
const DEFAULT_OAUTH_CALLBACK_PORT = 19876;
const DEFAULT_OAUTH_CALLBACK_PATH = "/callback";
let configuredOAuthCallbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
if (process.env.MCP_OAUTH_CALLBACK_PORT) {
	const parsedPort = Number.parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10);
	if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) configuredOAuthCallbackPort = parsedPort;
}
let oauthCallbackPort = configuredOAuthCallbackPort;
let oauthCallbackPath = DEFAULT_OAUTH_CALLBACK_PATH;
function getConfiguredOAuthCallbackPort() {
	return configuredOAuthCallbackPort;
}
function getOAuthCallbackPort() {
	return oauthCallbackPort;
}
function setOAuthCallbackPort(port) {
	oauthCallbackPort = port;
}
function getOAuthCallbackPath() {
	return oauthCallbackPath;
}
function setOAuthCallbackPath(path) {
	oauthCallbackPath = path.startsWith("/") ? path : `/${path}`;
}
/**
* OAuth provider implementation for MCP servers.
* Implements the OAuthClientProvider interface from the MCP SDK.
*/
var McpOAuthProvider = class {
	serverName;
	serverUrl;
	config;
	callbacks;
	redirectUrlSnapshot;
	constructor(serverName, serverUrl, config, callbacks) {
		this.serverName = serverName;
		this.serverUrl = serverUrl;
		this.config = config;
		this.callbacks = callbacks;
		this.redirectUrlSnapshot = config.grantType === "client_credentials" ? void 0 : config.redirectUri ?? `http://localhost:${getOAuthCallbackPort()}${getOAuthCallbackPath()}`;
	}
	get usesClientCredentials() {
		return this.config.grantType === "client_credentials";
	}
	/**
	* The redirect URL for OAuth callbacks.
	* This must match the redirect_uri in client metadata.
	*/
	get redirectUrl() {
		return this.redirectUrlSnapshot;
	}
	/**
	* Client metadata for dynamic registration.
	* Describes this client to the OAuth authorization server.
	*/
	get clientMetadata() {
		if (this.usesClientCredentials) return {
			client_name: this.config.clientName ?? "Pi Coding Agent",
			client_uri: this.config.clientUri ?? "https://github.com/nicobailon/pi-mcp-adapter",
			redirect_uris: [],
			grant_types: ["client_credentials"],
			token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none"
		};
		const redirectUrl = this.redirectUrl;
		if (!redirectUrl) throw new Error("redirectUrl is required for authorization_code flow");
		return {
			redirect_uris: [redirectUrl],
			client_name: this.config.clientName ?? "Pi Coding Agent",
			client_uri: this.config.clientUri ?? "https://github.com/nicobailon/pi-mcp-adapter",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
			...this.config.scope !== void 0 ? { scope: this.config.scope } : {}
		};
	}
	/**
	* Get client information (for pre-registered or dynamically registered clients).
	* Returns undefined if no client info exists or if the server URL has changed.
	*/
	async clientInformation() {
		if (this.config.clientId) return {
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret
		};
		const entry = await getAuthForUrl(this.serverName, this.serverUrl);
		if (entry?.clientInfo) {
			if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1e3) return;
			return {
				client_id: entry.clientInfo.clientId,
				client_secret: entry.clientInfo.clientSecret
			};
		}
	}
	/**
	* Save client information from dynamic registration.
	*/
	async saveClientInformation(info) {
		const redirectUris = info.redirect_uris ?? (this.redirectUrl ? [this.redirectUrl] : void 0);
		const clientInfo = {
			clientId: info.client_id,
			clientSecret: info.client_secret,
			clientIdIssuedAt: info.client_id_issued_at,
			clientSecretExpiresAt: info.client_secret_expires_at,
			redirectUris
		};
		updateClientInfo(this.serverName, clientInfo, this.serverUrl);
	}
	/**
	* Get stored OAuth tokens.
	* Returns undefined if no tokens exist or if the server URL has changed.
	*/
	async tokens() {
		const entry = await getAuthForUrl(this.serverName, this.serverUrl);
		if (!entry?.tokens) return void 0;
		return {
			access_token: entry.tokens.accessToken,
			token_type: "Bearer",
			refresh_token: entry.tokens.refreshToken,
			expires_in: entry.tokens.expiresAt ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1e3)) : void 0,
			scope: entry.tokens.scope
		};
	}
	/**
	* Save OAuth tokens.
	*/
	async saveTokens(tokens) {
		const storedTokens = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() / 1e3 + tokens.expires_in : void 0,
			scope: tokens.scope
		};
		updateTokens(this.serverName, storedTokens, this.serverUrl);
	}
	/**
	* Redirect the user to the authorization URL.
	* This opens the browser for the user to authenticate.
	*
	* Throws UnauthorizedError when called outside of a user-initiated flow
	* (no oauthState saved by startAuth). That path is reached when the SDK
	* falls through from a failed refresh into a fresh authorization_code
	* flow, which library hosts cannot complete in-process.
	*/
	async redirectToAuthorization(authorizationUrl) {
		if (this.usesClientCredentials) throw new Error("redirectToAuthorization is not used for client_credentials flow");
		if (!(await getAuthForUrl(this.serverName, this.serverUrl))?.oauthState) throw new UnauthorizedError(`Re-authentication required for MCP server: ${this.serverName}`);
		await this.callbacks.onRedirect(authorizationUrl);
	}
	/**
	* Save the PKCE code verifier.
	*/
	async saveCodeVerifier(codeVerifier) {
		updateCodeVerifier(this.serverName, codeVerifier, this.serverUrl);
	}
	/**
	* Get the stored PKCE code verifier.
	* @throws Error if no code verifier is stored
	*/
	async codeVerifier() {
		if (this.usesClientCredentials) throw new Error("codeVerifier is not used for client_credentials flow");
		const entry = await getAuthForUrl(this.serverName, this.serverUrl);
		if (!entry?.codeVerifier) throw new Error(`No code verifier saved for MCP server: ${this.serverName}`);
		return entry.codeVerifier;
	}
	/**
	* Save the OAuth state parameter for CSRF protection.
	*/
	async saveState(state) {
		updateOAuthState(this.serverName, state, this.serverUrl);
	}
	/**
	* Get the stored OAuth state parameter.
	* @throws UnauthorizedError if no flow is in progress (see redirectToAuthorization)
	*/
	async state() {
		if (this.usesClientCredentials) throw new Error("state is not used for client_credentials flow");
		const entry = await getAuthForUrl(this.serverName, this.serverUrl);
		if (!entry?.oauthState) throw new UnauthorizedError(`Re-authentication required for MCP server: ${this.serverName}`);
		return entry.oauthState;
	}
	/**
	* Invalidate credentials when authentication fails.
	* Clears tokens, client info, or all credentials based on the type.
	*/
	async invalidateCredentials(type) {
		switch (type) {
			case "all":
				clearAllCredentials(this.serverName);
				break;
			case "client":
				clearClientInfo(this.serverName);
				break;
			case "tokens":
				clearTokens(this.serverName);
				break;
		}
	}
	/**
	* Adds configured authorization-code scope without replacing the SDK's
	* default token endpoint authentication behavior.
	*/
	addClientAuthentication = async (headers, params, _url, metadata) => {
		if (params.get("grant_type") === "authorization_code" && !params.has("scope") && this.config.scope) params.set("scope", this.config.scope);
		const clientInfo = await this.clientInformation();
		if (!clientInfo) return;
		const supportedMethods = metadata?.token_endpoint_auth_methods_supported ?? [];
		const hasClientSecret = clientInfo.client_secret !== void 0;
		let authMethod;
		if (supportedMethods.length === 0) authMethod = hasClientSecret ? "client_secret_post" : "none";
		else if (hasClientSecret && supportedMethods.includes("client_secret_basic")) authMethod = "client_secret_basic";
		else if (hasClientSecret && supportedMethods.includes("client_secret_post")) authMethod = "client_secret_post";
		else if (supportedMethods.includes("none")) authMethod = "none";
		else authMethod = hasClientSecret ? "client_secret_post" : "none";
		if (authMethod === "client_secret_basic") {
			if (!clientInfo.client_secret) throw new Error("client_secret_basic authentication requires a client_secret");
			headers.set("Authorization", `Basic ${Buffer.from(`${clientInfo.client_id}:${clientInfo.client_secret}`).toString("base64")}`);
			return;
		}
		if (!params.has("client_id")) params.set("client_id", clientInfo.client_id);
		if (authMethod === "client_secret_post" && clientInfo.client_secret && !params.has("client_secret")) params.set("client_secret", clientInfo.client_secret);
	};
	prepareTokenRequest(scope) {
		if (!this.usesClientCredentials) return;
		const params = new URLSearchParams({ grant_type: "client_credentials" });
		const requestedScope = scope ?? this.config.scope;
		if (requestedScope) params.set("scope", requestedScope);
		return params;
	}
};
//#endregion
//#region src/mcp-callback-server.ts
/**
* MCP OAuth Callback Server
*
* HTTP server that handles OAuth callbacks from the authorization server.
* Uses Node.js http module for compatibility.
*/
const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>Pi - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to Pi.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);<\/script>
</body>
</html>`;
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const HTML_ERROR = (error) => `<!DOCTYPE html>
<html>
<head>
  <title>Pi - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${escapeHtml(error)}</div>
  </div>
</body>
</html>`;
/** Server singleton state */
let server;
let bindingPromise;
const pendingAuths = /* @__PURE__ */ new Map();
const reservedAuthStates = /* @__PURE__ */ new Set();
/** Timeout for callback completion (5 minutes) */
const CALLBACK_TIMEOUT_MS = 300 * 1e3;
const DEFAULT_OAUTH_CALLBACK_HOST = "localhost";
let callbackServerHost = DEFAULT_OAUTH_CALLBACK_HOST;
/**
* Handle incoming HTTP requests to the callback server.
*/
function handleRequest(req, res) {
	const url = new URL(req.url || "/", `http://${req.headers.host}`);
	if (url.pathname !== getOAuthCallbackPath()) {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
		return;
	}
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");
	if (!state) {
		const errorMsg = "Missing required state parameter - potential CSRF attack";
		res.writeHead(400, { "Content-Type": "text/html" });
		res.end(HTML_ERROR(errorMsg));
		return;
	}
	const pending = pendingAuths.get(state);
	const isReserved = reservedAuthStates.has(state);
	if (error) {
		if (!pending && !isReserved) {
			const errorMsg = "Invalid or expired state parameter - potential CSRF attack";
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end(HTML_ERROR(errorMsg));
			return;
		}
		const errorMsg = errorDescription || error;
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(HTML_ERROR(errorMsg));
		reservedAuthStates.delete(state);
		if (pending) {
			clearTimeout(pending.timeout);
			pendingAuths.delete(state);
			setTimeout(() => pending.reject(new Error(errorMsg)), 0);
		}
		return;
	}
	if (!pending) {
		const errorMsg = "Invalid or expired state parameter - potential CSRF attack";
		res.writeHead(400, { "Content-Type": "text/html" });
		res.end(HTML_ERROR(errorMsg));
		return;
	}
	if (!code) {
		res.writeHead(400, { "Content-Type": "text/html" });
		res.end(HTML_ERROR("No authorization code provided"));
		return;
	}
	clearTimeout(pending.timeout);
	pendingAuths.delete(state);
	pending.resolve(code);
	res.writeHead(200, { "Content-Type": "text/html" });
	res.end(HTML_SUCCESS);
}
/**
* Ensure the callback server is running.
* If strictPort is true, requires binding on the configured callback port.
* If strictPort is false, asks the OS for an available local port.
*/
async function ensureCallbackServer(options = {}) {
	while (bindingPromise) await bindingPromise;
	const operation = ensureCallbackServerLocked(options);
	bindingPromise = operation;
	try {
		await operation;
	} finally {
		if (bindingPromise === operation) bindingPromise = void 0;
	}
}
async function ensureCallbackServerLocked(options = {}) {
	const requiredPort = options.port ?? getConfiguredOAuthCallbackPort();
	const strictPort = options.strictPort === true;
	const requestedHost = options.callbackHost ?? DEFAULT_OAUTH_CALLBACK_HOST;
	const rawRequestedPath = options.callbackPath ?? "/callback";
	const requestedPath = rawRequestedPath.startsWith("/") ? rawRequestedPath : `/${rawRequestedPath}`;
	if (options.reserveState && !options.oauthState) throw new Error("OAuth callback reservation requires an oauthState");
	let reservedState;
	const previousServer = server;
	const needsStrictRebind = Boolean(previousServer && strictPort && getOAuthCallbackPort() !== requiredPort);
	const needsHostSwitch = Boolean(previousServer && callbackServerHost !== requestedHost);
	const needsPathSwitch = Boolean(previousServer && getOAuthCallbackPath() !== requestedPath);
	if (previousServer) {
		if (!needsStrictRebind && !needsHostSwitch) {
			if (needsPathSwitch) {
				if (pendingAuths.size > 0 || reservedAuthStates.size > 0) throw new Error(`OAuth callback server is using path ${getOAuthCallbackPath()}, but callback path ${requestedPath} is required and cannot be switched while authorizations are pending`);
				setOAuthCallbackPath(requestedPath);
			}
			if (options.reserveState && options.oauthState) {
				reservedAuthStates.add(options.oauthState);
				reservedState = options.oauthState;
			}
			return;
		}
		if (pendingAuths.size > 0 || reservedAuthStates.size > 0) throw new Error(`OAuth callback server is running on ${callbackServerHost}:${getOAuthCallbackPort()}, but strict callback endpoint ${requestedHost}:${requiredPort} is required and cannot be switched while authorizations are pending`);
	}
	const candidateServer = createServer(handleRequest);
	const listenPort = strictPort ? requiredPort : 0;
	try {
		await new Promise((resolve, reject) => {
			candidateServer.once("error", (err) => {
				reject(err);
			});
			candidateServer.listen(listenPort, requestedHost, () => {
				resolve();
			});
		});
		if (strictPort) setOAuthCallbackPort(requiredPort);
		else {
			const address = candidateServer.address();
			if (!address || typeof address === "string" || typeof address.port !== "number") throw new Error("OAuth callback server did not report an assigned port");
			setOAuthCallbackPort(address.port);
		}
		if (previousServer && (needsStrictRebind || needsHostSwitch)) await new Promise((resolve) => {
			previousServer.close(() => resolve());
		});
		callbackServerHost = requestedHost;
		setOAuthCallbackPath(requestedPath);
		server = candidateServer;
		if (options.reserveState && options.oauthState) {
			reservedAuthStates.add(options.oauthState);
			reservedState = options.oauthState;
		}
		server.unref();
	} catch (error) {
		if (reservedState) reservedAuthStates.delete(reservedState);
		const nodeError = error;
		await new Promise((resolve) => {
			candidateServer.close(() => resolve());
		});
		if (strictPort && nodeError.code === "EADDRINUSE") throw new Error(`OAuth callback port ${requiredPort} is already in use. Pre-registered OAuth clients require an exact redirect URI; set MCP_OAUTH_CALLBACK_PORT to your registered port or free port ${requiredPort}`, { cause: error });
		throw error;
	}
}
function releaseCallbackServer(oauthState) {
	reservedAuthStates.delete(oauthState);
}
/**
* Wait for a callback with the given OAuth state.
* Returns a promise that resolves with the authorization code.
*/
function waitForCallback(oauthState) {
	reservedAuthStates.delete(oauthState);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			if (pendingAuths.has(oauthState)) {
				pendingAuths.delete(oauthState);
				reject(/* @__PURE__ */ new Error("OAuth callback timeout - authorization took too long"));
			}
		}, CALLBACK_TIMEOUT_MS);
		pendingAuths.set(oauthState, {
			resolve,
			reject,
			timeout
		});
	});
}
/**
* Cancel a pending authorization by state.
*/
function cancelPendingCallback(oauthState) {
	reservedAuthStates.delete(oauthState);
	const pending = pendingAuths.get(oauthState);
	if (pending) {
		clearTimeout(pending.timeout);
		pendingAuths.delete(oauthState);
		pending.reject(/* @__PURE__ */ new Error("Authorization cancelled"));
	}
}
/**
* Stop the callback server and reject all pending authorizations.
*/
async function stopCallbackServer() {
	if (server) {
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		server = void 0;
	}
	setOAuthCallbackPort(getConfiguredOAuthCallbackPort());
	callbackServerHost = DEFAULT_OAUTH_CALLBACK_HOST;
	setOAuthCallbackPath(DEFAULT_OAUTH_CALLBACK_PATH);
	const pendingList = Array.from(pendingAuths.entries());
	pendingAuths.clear();
	reservedAuthStates.clear();
	setTimeout(() => {
		for (const [, pending] of pendingList) {
			clearTimeout(pending.timeout);
			pending.reject(/* @__PURE__ */ new Error("OAuth callback server stopped"));
		}
	}, 0);
}
//#endregion
//#region src/mcp-auth-flow.ts
/**
* MCP Auth Flow
*
* High-level OAuth flow management using the MCP SDK's built-in auth functions.
*/
var mcp_auth_flow_exports = /* @__PURE__ */ __exportAll({
	authenticate: () => authenticate,
	completeAuth: () => completeAuth,
	completeAuthFromInput: () => completeAuthFromInput,
	extractOAuthConfig: () => extractOAuthConfig,
	initializeOAuth: () => initializeOAuth,
	parseAuthorizationCodeInput: () => parseAuthorizationCodeInput,
	removeAuth: () => removeAuth,
	shutdownOAuth: () => shutdownOAuth,
	startAuth: () => startAuth,
	supportsOAuth: () => supportsOAuth
});
const pendingTransports = /* @__PURE__ */ new Map();
const pendingAuthStates = /* @__PURE__ */ new Map();
const pendingAuthCleanupTimers = /* @__PURE__ */ new Map();
const pendingAuthentications = /* @__PURE__ */ new Map();
/** Timeout for manual auth completion (5 minutes) */
const MANUAL_AUTH_TIMEOUT_MS = 300 * 1e3;
/**
* Generate a cryptographically secure random state parameter.
*/
function generateState() {
	return Array.from(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Extract OAuth configuration from a ServerEntry.
*/
function extractOAuthConfig(definition) {
	if (definition.oauth === false) return {};
	const config = {};
	if (definition.oauth?.grantType !== void 0) config.grantType = definition.oauth.grantType;
	if (definition.oauth?.clientId !== void 0) config.clientId = definition.oauth.clientId;
	if (definition.oauth?.clientSecret !== void 0) config.clientSecret = definition.oauth.clientSecret;
	if (definition.oauth?.scope !== void 0) config.scope = definition.oauth.scope;
	if (definition.oauth?.redirectUri !== void 0) {
		if (typeof definition.oauth.redirectUri !== "string") throw new Error("OAuth redirectUri must be a string");
		const redirectUri = definition.oauth.redirectUri.trim();
		if (!redirectUri) throw new Error("OAuth redirectUri must not be empty");
		config.redirectUri = redirectUri;
	}
	if (definition.oauth?.clientName !== void 0) {
		if (typeof definition.oauth.clientName !== "string") throw new Error("OAuth clientName must be a string");
		const clientName = definition.oauth.clientName.trim();
		if (!clientName) throw new Error("OAuth clientName must not be empty");
		config.clientName = clientName;
	}
	if (definition.oauth?.clientUri !== void 0) {
		if (typeof definition.oauth.clientUri !== "string") throw new Error("OAuth clientUri must be a string");
		const clientUri = definition.oauth.clientUri.trim();
		if (!clientUri) throw new Error("OAuth clientUri must not be empty");
		config.clientUri = clientUri;
	}
	return config;
}
function parseOAuthRedirectUri(redirectUri) {
	let url;
	try {
		url = new URL(redirectUri);
	} catch (error) {
		throw new Error(`Invalid OAuth redirectUri: ${redirectUri}`, { cause: error });
	}
	const hostname = url.hostname.toLowerCase();
	const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
	if (url.protocol !== "http:" || !isLocalhost) throw new Error("OAuth redirectUri must be an http:// localhost or loopback URI");
	if (url.username || url.password) throw new Error("OAuth redirectUri must not include username or password");
	if (url.hash) throw new Error("OAuth redirectUri must not include a fragment");
	if (!url.port) throw new Error("OAuth redirectUri must include an explicit numeric port");
	const port = Number.parseInt(url.port, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("OAuth redirectUri must include an explicit numeric port");
	return {
		port,
		callbackHost: hostname === "[::1]" ? "::1" : hostname,
		callbackPath: url.pathname
	};
}
/**
* Start OAuth authentication flow for a server.
* Returns the authorization URL when browser authorization is required.
*/
async function startAuth(serverName, serverUrl, definition) {
	const config = definition ? extractOAuthConfig(definition) : {};
	if (config.grantType === "client_credentials") {
		const storedAuth = await getAuthForUrl(serverName, serverUrl);
		if (storedAuth?.clientInfo && !storedAuth.tokens && !config.clientId) {
			clearClientInfo(serverName);
			clearCodeVerifier(serverName);
			await clearOAuthState(serverName);
		}
		if (await auth(new McpOAuthProvider(serverName, serverUrl, config, { onRedirect: async () => {
			throw new Error("Browser redirect is not used for client_credentials flow");
		} }), { serverUrl }) !== "AUTHORIZED") throw new UnauthorizedError("Failed to authorize");
		return { authorizationUrl: "" };
	}
	const redirectCallback = config.redirectUri !== void 0 ? parseOAuthRedirectUri(config.redirectUri) : void 0;
	const oauthState = generateState();
	try {
		await ensureCallbackServer({
			strictPort: Boolean(config.clientId) || config.redirectUri !== void 0,
			oauthState,
			reserveState: true,
			...redirectCallback ? {
				port: redirectCallback.port,
				callbackHost: redirectCallback.callbackHost,
				callbackPath: redirectCallback.callbackPath
			} : {}
		});
	} catch (error) {
		await clearOAuthState(serverName);
		throw error;
	}
	let capturedUrl;
	const authProvider = new McpOAuthProvider(serverName, serverUrl, config, { onRedirect: async (url) => {
		capturedUrl = url;
	} });
	try {
		const storedAuth = await getAuthForUrl(serverName, serverUrl);
		if (storedAuth?.clientInfo && !config.clientId) if (!storedAuth.tokens) {
			clearClientInfo(serverName);
			clearCodeVerifier(serverName);
			await clearOAuthState(serverName);
		} else {
			const redirectUris = storedAuth.clientInfo.redirectUris;
			if (!Array.isArray(redirectUris) || !redirectUris.includes(authProvider.redirectUrl ?? "")) {
				clearClientInfo(serverName);
				clearTokens(serverName);
				clearCodeVerifier(serverName);
				await clearOAuthState(serverName);
			}
		}
		await updateOAuthState(serverName, oauthState, serverUrl);
		if (await auth(authProvider, { serverUrl }) === "AUTHORIZED") {
			releaseCallbackServer(oauthState);
			await clearOAuthState(serverName);
			return { authorizationUrl: "" };
		}
		if (!capturedUrl) throw new UnauthorizedError("OAuth authorization URL was not provided");
		await setPendingTransport(serverName, new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider }), oauthState);
		return { authorizationUrl: capturedUrl.toString() };
	} catch (error) {
		await clearPendingAuth(serverName, oauthState);
		throw error;
	}
}
async function setPendingTransport(serverName, transport, oauthState) {
	await clearPendingAuth(serverName);
	pendingTransports.set(serverName, transport);
	pendingAuthStates.set(serverName, oauthState);
	const cleanupTimer = setTimeout(() => {
		clearPendingAuth(serverName, oauthState);
	}, MANUAL_AUTH_TIMEOUT_MS);
	cleanupTimer.unref?.();
	pendingAuthCleanupTimers.set(serverName, cleanupTimer);
}
async function clearPendingAuth(serverName, oauthState) {
	const pendingState = pendingAuthStates.get(serverName);
	if (oauthState && pendingState && pendingState !== oauthState) return;
	const timer = pendingAuthCleanupTimers.get(serverName);
	if (timer) {
		clearTimeout(timer);
		pendingAuthCleanupTimers.delete(serverName);
	}
	const transport = pendingTransports.get(serverName);
	pendingTransports.delete(serverName);
	pendingAuthStates.delete(serverName);
	const stateToRelease = pendingState ?? oauthState;
	if (stateToRelease) {
		releaseCallbackServer(stateToRelease);
		if (await getOAuthState(serverName) === stateToRelease) await clearOAuthState(serverName);
	}
	if (transport) await transport.close().catch(() => {});
}
function getSearchParamsFromInput(input) {
	try {
		const url = new URL(input);
		const params = new URLSearchParams(url.search);
		if (url.hash) {
			const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
			const hashParams = new URLSearchParams(hash);
			for (const [key, value] of hashParams) if (!params.has(key)) params.set(key, value);
		}
		return params;
	} catch {
		const query = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
		const params = new URLSearchParams(query.startsWith("#") ? query.slice(1) : query);
		return params.has("code") || params.has("state") || params.has("error") ? params : void 0;
	}
}
/**
* Extract an OAuth authorization code from either a raw code, a query string,
* or the full localhost redirect URL copied from the browser address bar.
*/
function parseAuthorizationCodeInput(input, expectedState) {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("Authorization code or redirect URL is required");
	const params = getSearchParamsFromInput(trimmed);
	if (params) {
		const error = params.get("error");
		if (error) {
			const description = params.get("error_description");
			throw new Error(description ? `${error}: ${description}` : error);
		}
		const state = params.get("state");
		if (expectedState && !state) throw new Error("OAuth state missing from redirect URL");
		if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch - potential CSRF attack");
		const code = params.get("code");
		if (code) return code;
	}
	if (/^[A-Za-z0-9._~+/=-]+$/.test(trimmed)) return trimmed;
	throw new Error("Could not find an OAuth authorization code in the provided input");
}
/**
* Complete OAuth authentication from manual user input.
*/
async function completeAuthFromInput(serverName, input) {
	return completeAuth(serverName, parseAuthorizationCodeInput(input, await getOAuthState(serverName)));
}
/**
* Complete OAuth authentication with the authorization code.
*/
async function completeAuth(serverName, authorizationCode) {
	const transport = pendingTransports.get(serverName);
	if (!transport) throw new Error(`No pending OAuth flow for server: ${serverName}`);
	const oauthState = await getOAuthState(serverName);
	try {
		await transport.finishAuth(authorizationCode);
		return "authenticated";
	} finally {
		await clearPendingAuth(serverName, oauthState);
	}
}
/**
* Perform the complete OAuth authentication flow for a server.
*
* @param serverName - The name of the MCP server
* @param serverUrl - The URL of the MCP server
* @param definition - The server definition (optional)
* @returns The final auth status
*/
async function authenticate(serverName, serverUrl, definition, options = {}) {
	const inFlight = pendingAuthentications.get(serverName);
	if (inFlight) return inFlight;
	const operation = (async () => {
		const { authorizationUrl } = await startAuth(serverName, serverUrl, definition);
		if (!authorizationUrl) return "authenticated";
		const oauthState = await getOAuthState(serverName);
		if (!oauthState) throw new Error("OAuth state not found - this should not happen");
		const callbackPromise = waitForCallback(oauthState);
		try {
			if (options.onAuthorizationUrl) await options.onAuthorizationUrl(authorizationUrl);
			else console.log(`MCP Auth: Open this URL to authenticate ${serverName}:\n${authorizationUrl}`);
			try {
				await open(authorizationUrl);
			} catch (error) {
				console.warn(`MCP Auth: Failed to open browser for ${serverName}; waiting for manual callback`, { error });
			}
			const code = await callbackPromise;
			if (await getOAuthState(serverName) !== oauthState) {
				await clearOAuthState(serverName);
				throw new Error("OAuth state mismatch - potential CSRF attack");
			}
			await clearOAuthState(serverName);
			return await completeAuth(serverName, code);
		} catch (error) {
			cancelPendingCallback(oauthState);
			await clearPendingAuth(serverName, oauthState);
			throw error;
		}
	})();
	pendingAuthentications.set(serverName, operation);
	try {
		return await operation;
	} finally {
		if (pendingAuthentications.get(serverName) === operation) pendingAuthentications.delete(serverName);
	}
}
/**
* Remove all OAuth credentials for a server.
*
* @param serverName - The name of the MCP server
*/
async function removeAuth(serverName) {
	const oauthState = await getOAuthState(serverName);
	if (oauthState) cancelPendingCallback(oauthState);
	await clearPendingAuth(serverName, oauthState);
	clearAllCredentials(serverName);
	await clearOAuthState(serverName);
	console.log(`MCP Auth: Removed credentials for ${serverName}`);
}
/**
* Check if OAuth is supported for a server configuration.
* OAuth is supported for HTTP servers unless explicitly disabled.
*
* @param definition - The server definition
* @returns True if OAuth is supported
*/
function supportsOAuth(definition) {
	if (!definition.url) return false;
	if (definition.auth === false) return false;
	if (definition.oauth === false) return false;
	if (definition.auth === "oauth") return true;
	if (definition.headers && Object.keys(definition.headers).length > 0) return false;
	return definition.auth === void 0;
}
/**
* Initialize the OAuth system on startup.
* OAuth callback binding is lazy and starts from startAuth() only.
*/
async function initializeOAuth() {}
/**
* Shutdown the OAuth system.
* Stops the callback server and cancels pending auths.
*/
async function shutdownOAuth() {
	for (const serverName of Array.from(pendingTransports.keys())) await clearPendingAuth(serverName);
	await stopCallbackServer();
}
//#endregion
export { removeAuth as a, McpOAuthProvider as c, mcp_auth_flow_exports as i, getAuthForUrl as l, completeAuthFromInput as n, startAuth as o, extractOAuthConfig as r, supportsOAuth as s, authenticate as t, __exportAll as u };
