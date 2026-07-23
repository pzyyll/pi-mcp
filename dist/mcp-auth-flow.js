import { clearAllCredentials, clearClientInfo, clearCodeVerifier, clearOAuthState, clearTokens, getAuthForUrl, getOAuthState, hasStoredTokens, isTokenExpired, updateOAuthState } from "./mcp-auth.js";
import { McpOAuthProvider } from "./mcp-oauth-provider.js";
import { cancelPendingCallback, ensureCallbackServer, releaseCallbackServer, stopCallbackServer, waitForCallback } from "./mcp-callback-server.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, auth } from "@modelcontextprotocol/sdk/client/auth.js";
import open from "open";
//#region src/mcp-auth-flow.ts
/**
* MCP Auth Flow
* 
* High-level OAuth flow management using the MCP SDK's built-in auth functions.
*/
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
* Get a valid access token for a server, refreshing if necessary.
* 
* @param serverName - The name of the MCP server
* @param serverUrl - The URL of the MCP server
* @returns The valid tokens or null if not authenticated
*/
async function getValidToken(serverName, serverUrl) {
	const entry = await getAuthForUrl(serverName, serverUrl);
	if (!entry?.tokens) return null;
	const expired = await isTokenExpired(serverName);
	if (expired === false) return entry.tokens;
	if (expired === true && entry.tokens.refreshToken) {
		console.log(`MCP Auth: Token expired for ${serverName}, attempting refresh`);
		try {
			const authProvider = new McpOAuthProvider(serverName, serverUrl, {}, { onRedirect: async () => {} });
			if (!await authProvider.clientInformation()) {
				console.log(`MCP Auth: No client info for refresh for ${serverName}`);
				return null;
			}
			if (await auth(authProvider, { serverUrl }) !== "AUTHORIZED") return null;
			return (await getAuthForUrl(serverName, serverUrl))?.tokens ?? null;
		} catch (error) {
			console.error(`MCP Auth: Token refresh failed for ${serverName}`, { error });
			return null;
		}
	}
	return entry.tokens;
}
/**
* Check the authentication status for a server.
* 
* @param serverName - The name of the MCP server
* @returns The current auth status
*/
async function getAuthStatus(serverName) {
	if (!await hasStoredTokens(serverName)) return "not_authenticated";
	return await isTokenExpired(serverName) ? "expired" : "authenticated";
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
export { authenticate, completeAuth, completeAuthFromInput, extractOAuthConfig, getAuthStatus, getValidToken, initializeOAuth, parseAuthorizationCodeInput, removeAuth, shutdownOAuth, startAuth, supportsOAuth };
