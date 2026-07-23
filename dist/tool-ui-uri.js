//#region src/tool-ui-uri.ts
/** Preferred nested key used by current MCP Apps servers. */
const UI_RESOURCE_URI_NESTED_KEY = "resourceUri";
/** Deprecated flat meta key retained for backward compatibility. */
const UI_RESOURCE_URI_LEGACY_META_KEY = "ui/resourceUri";
const UI_RESOURCE_URI_SCHEME_PREFIX = "ui://";
/**
* Resolve a tool's UI resource URI from `_meta`.
* Mirrors `@modelcontextprotocol/ext-apps/app-bridge` `getToolUiResourceUri`.
*/
function getToolUiResourceUri(tool) {
	const meta = tool._meta;
	if (!meta || typeof meta !== "object") return void 0;
	const nestedUi = meta.ui;
	let uri;
	if (nestedUi && typeof nestedUi === "object" && !Array.isArray(nestedUi)) uri = nestedUi[UI_RESOURCE_URI_NESTED_KEY];
	if (uri === void 0) uri = meta[UI_RESOURCE_URI_LEGACY_META_KEY];
	if (typeof uri === "string" && uri.startsWith(UI_RESOURCE_URI_SCHEME_PREFIX)) return uri;
	if (uri !== void 0) throw new Error(`Invalid UI resource URI: ${JSON.stringify(uri)}`);
}
//#endregion
export { getToolUiResourceUri };
