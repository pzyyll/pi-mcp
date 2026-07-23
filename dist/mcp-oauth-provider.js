import { clearAllCredentials, clearClientInfo, clearTokens, getAuthForUrl, updateClientInfo, updateCodeVerifier, updateOAuthState, updateTokens } from "./mcp-auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
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
export { DEFAULT_OAUTH_CALLBACK_PATH, DEFAULT_OAUTH_CALLBACK_PORT, McpOAuthProvider, getConfiguredOAuthCallbackPort, getOAuthCallbackPath, getOAuthCallbackPort, setOAuthCallbackPath, setOAuthCallbackPort };
