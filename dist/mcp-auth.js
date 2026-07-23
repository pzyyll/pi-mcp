import { getAgentPath } from "./agent-dir.js";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
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
* Check if stored tokens are expired.
* Returns null if no tokens exist, false if no expiry or not expired, true if expired.
*/
function isTokenExpired(serverName) {
	const entry = getAuthEntry(serverName);
	if (!entry?.tokens) return null;
	if (!entry.tokens.expiresAt) return false;
	return entry.tokens.expiresAt < Date.now() / 1e3;
}
/**
* Check if a server has stored tokens.
*/
function hasStoredTokens(serverName) {
	return !!getAuthEntry(serverName)?.tokens;
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
export { clearAllCredentials, clearClientInfo, clearCodeVerifier, clearOAuthState, clearTokens, getAuthEntry, getAuthEntryFilePath, getAuthForUrl, getOAuthState, hasStoredTokens, isTokenExpired, removeAuthEntry, saveAuthEntry, updateClientInfo, updateCodeVerifier, updateOAuthState, updateTokens };
