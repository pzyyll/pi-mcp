//#region src/tool-names.ts
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
//#region src/resource-tools.ts
function resourceNameToToolName(name) {
	let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "").toLowerCase();
	if (!result || /^\d/.test(result)) result = "resource" + (result ? "_" + result : "");
	return result;
}
//#endregion
export { isToolExcluded as i, formatToolName as n, getServerPrefix as r, resourceNameToToolName as t };
