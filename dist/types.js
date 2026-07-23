import { SERVER_STREAM_RESULT_PATCH_METHOD, UI_STREAM_HOST_CONTEXT_KEY, UI_STREAM_REQUEST_META_KEY, UI_STREAM_RESULT_PATCH_METHOD, UI_STREAM_STRUCTURED_CONTENT_KEY, getUiStreamHostContext, getVisualizationStreamEnvelope, serverStreamResultPatchNotificationSchema, uiStreamCallToolResultSchema, uiStreamHostContextSchema, uiStreamModeSchema, uiStreamResultPatchNotificationSchema, visualizationStreamEnvelopeSchema, visualizationStreamFrameTypeSchema, visualizationStreamPhaseSchema, visualizationStreamStatusSchema } from "./ui-stream-types.js";
//#region src/types.ts
/**
* Extract prompt text from either legacy MCP UI message shapes or native AppBridge user messages.
*/
function extractUiPromptText(params) {
	if (params.type === "prompt" || params.prompt) return (params.prompt ?? String(params.message ?? "")) || void 0;
	if (params.role === "user" && Array.isArray(params.content)) return params.content.map((block) => block && typeof block === "object" && "text" in block ? String(block.text ?? "") : "").filter(Boolean).join("\n\n") || void 0;
}
/**
* Parse a canonical named UI handoff encoded as `intent\n{json}`.
*/
function parseUiPromptHandoff(prompt) {
	const newlineIndex = prompt.indexOf("\n");
	if (newlineIndex <= 0) return;
	const intent = prompt.slice(0, newlineIndex).trim();
	const payloadText = prompt.slice(newlineIndex + 1).trim();
	if (!intent || !payloadText) return;
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(intent)) return;
	try {
		const parsed = JSON.parse(payloadText);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
		return {
			intent,
			params: parsed,
			raw: prompt
		};
	} catch {
		return;
	}
}
/**
* Get server prefix based on tool prefix mode.
*/
function getServerPrefix(serverName, mode) {
	if (mode === "none") return "";
	if (mode === "short") {
		let short = serverName.replace(/-?mcp$/i, "").replace(/-/g, "_");
		if (!short) short = "mcp";
		return short;
	}
	return serverName.replace(/-/g, "_");
}
/**
* Format a tool name with server prefix.
*/
function formatToolName(toolName, serverName, prefix) {
	const p = getServerPrefix(serverName, prefix);
	return p ? `${p}_${toolName}` : toolName;
}
function normalizeToolName(value) {
	return value.replace(/-/g, "_");
}
function isToolExcluded(toolName, serverName, prefix, excludeTools) {
	if (!Array.isArray(excludeTools) || excludeTools.length === 0) return false;
	const candidates = /* @__PURE__ */ new Set([
		normalizeToolName(toolName),
		normalizeToolName(formatToolName(toolName, serverName, prefix)),
		normalizeToolName(formatToolName(toolName, serverName, "server")),
		normalizeToolName(formatToolName(toolName, serverName, "short"))
	]);
	for (const excluded of excludeTools) {
		if (typeof excluded !== "string") continue;
		if (candidates.has(normalizeToolName(excluded))) return true;
	}
	return false;
}
//#endregion
export { SERVER_STREAM_RESULT_PATCH_METHOD, UI_STREAM_HOST_CONTEXT_KEY, UI_STREAM_REQUEST_META_KEY, UI_STREAM_RESULT_PATCH_METHOD, UI_STREAM_STRUCTURED_CONTENT_KEY, extractUiPromptText, formatToolName, getServerPrefix, getUiStreamHostContext, getVisualizationStreamEnvelope, isToolExcluded, parseUiPromptHandoff, serverStreamResultPatchNotificationSchema, uiStreamCallToolResultSchema, uiStreamHostContextSchema, uiStreamModeSchema, uiStreamResultPatchNotificationSchema, visualizationStreamEnvelopeSchema, visualizationStreamFrameTypeSchema, visualizationStreamPhaseSchema, visualizationStreamStatusSchema };
