// ABOUTME: Pure helper that extracts MCP Apps UI resource URIs from tool _meta.
// ABOUTME: Inlines the tiny app-bridge lookup so the factory path avoids loading ext-apps.

/** Preferred nested key used by current MCP Apps servers. */
const UI_RESOURCE_URI_NESTED_KEY = "resourceUri";
/** Deprecated flat meta key retained for backward compatibility. */
const UI_RESOURCE_URI_LEGACY_META_KEY = "ui/resourceUri";
const UI_RESOURCE_URI_SCHEME_PREFIX = "ui://";

/**
 * Resolve a tool's UI resource URI from `_meta`.
 * Mirrors `@modelcontextprotocol/ext-apps/app-bridge` `getToolUiResourceUri`.
 */
export function getToolUiResourceUri(tool: { _meta?: Record<string, unknown> | undefined }): string | undefined {
  const meta = tool._meta;
  if (!meta || typeof meta !== "object") return undefined;

  const nestedUi = meta.ui;
  let uri: unknown;
  if (nestedUi && typeof nestedUi === "object" && !Array.isArray(nestedUi)) {
    uri = (nestedUi as Record<string, unknown>)[UI_RESOURCE_URI_NESTED_KEY];
  }
  if (uri === undefined) {
    uri = meta[UI_RESOURCE_URI_LEGACY_META_KEY];
  }

  if (typeof uri === "string" && uri.startsWith(UI_RESOURCE_URI_SCHEME_PREFIX)) {
    return uri;
  }
  if (uri !== undefined) {
    throw new Error(`Invalid UI resource URI: ${JSON.stringify(uri)}`);
  }
  return undefined;
}
