import { getAuthEntryFilePath } from "./mcp-auth.js";
import { existsSync, readFileSync } from "node:fs";
//#region src/oauth-handler.ts
function getTokensPath(serverName) {
	return getAuthEntryFilePath(serverName);
}
/**
* Get stored OAuth tokens for a server (if any).
* Returns undefined if no tokens or tokens are expired.
* 
* Token file location: $MCP_OAUTH_DIR/sha256-<server-hash>/tokens.json when set,
* otherwise <Pi agent dir>/mcp-oauth/sha256-<server-hash>/tokens.json
* 
* Expected format:
* {
*   "access_token": "...",
*   "token_type": "bearer",
*   "refresh_token": "...",  // optional
*   "expires_in": 3600,      // optional, seconds
*   "expiresAt": 1234567890  // optional, absolute timestamp ms
* }
*/
function getStoredTokens(serverName) {
	const tokensPath = getTokensPath(serverName);
	if (!existsSync(tokensPath)) return void 0;
	try {
		const stored = JSON.parse(readFileSync(tokensPath, "utf-8"));
		if (!stored.access_token || typeof stored.access_token !== "string") return;
		if (stored.expiresAt && typeof stored.expiresAt === "number") {
			if (Date.now() > stored.expiresAt) return;
		}
		return {
			access_token: stored.access_token,
			token_type: stored.token_type ?? "bearer",
			refresh_token: stored.refresh_token,
			expires_in: stored.expires_in
		};
	} catch {
		return;
	}
}
//#endregion
export { getStoredTokens };
