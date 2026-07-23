import { DEFAULT_OAUTH_CALLBACK_PATH, getConfiguredOAuthCallbackPort, getOAuthCallbackPath, getOAuthCallbackPort, setOAuthCallbackPath, setOAuthCallbackPort } from "./mcp-oauth-provider.js";
import { createServer } from "http";
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
function reserveCallbackServer(oauthState) {
	reservedAuthStates.add(oauthState);
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
/**
* Check if the callback server is running.
*/
function isCallbackServerRunning() {
	return server !== void 0;
}
/**
* Get the number of pending authorizations.
*/
function getPendingAuthCount() {
	return pendingAuths.size;
}
//#endregion
export { cancelPendingCallback, ensureCallbackServer, getPendingAuthCount, isCallbackServerRunning, releaseCallbackServer, reserveCallbackServer, stopCallbackServer, waitForCallback };
