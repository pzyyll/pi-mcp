import { Text } from "@earendil-works/pi-tui";
//#region src/tool-result-renderer.ts
const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
function truncateText(value, maxChars) {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
function formatJsonish(value, maxChars) {
	if (typeof value === "string") try {
		return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
	} catch {
		return truncateText(value, maxChars);
	}
	try {
		return truncateText(JSON.stringify(value, null, 2), maxChars);
	} catch {
		return truncateText(String(value), maxChars);
	}
}
function hasUsefulObjectContent(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
function formatMcpProxyToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
	if (args.action === "ui-messages") return [`mcp ${args.action}`];
	if (args.tool) {
		const lines = [`mcp call ${args.server ? `${args.tool} @ ${args.server}` : args.tool}`];
		if (args.args) lines.push(formatJsonish(args.args, maxInputChars));
		return lines;
	}
	if (args.connect) return [`mcp connect ${args.connect}`];
	if (args.describe) return [`mcp describe ${args.describe}`];
	if (args.search) {
		let line = `mcp search ${args.search}`;
		if (args.server) line += ` @ ${args.server}`;
		if (args.regex === true) line += " (regex)";
		if (args.includeSchemas === false) line += " (schemas hidden)";
		return [line];
	}
	if (args.server) return [`mcp list ${args.server}`];
	if (args.action) return [`mcp ${args.action}`];
	return ["mcp status"];
}
function formatMcpDirectToolCallLines(displayName, args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
	if (!hasUsefulObjectContent(args)) return [displayName];
	return [displayName, formatJsonish(args, maxInputChars)];
}
function renderToolCallLines(lines, theme) {
	const [title = "mcp", ...rest] = lines;
	return new Text([theme.fg("toolTitle", theme.bold ? theme.bold(title) : title), ...rest.map((line) => theme.fg("muted", line))].join("\n"), 0, 0);
}
function renderMcpProxyToolCall(args, theme) {
	return renderToolCallLines(formatMcpProxyToolCallLines(args), theme);
}
function createMcpDirectToolCallRenderer(displayName) {
	return (args, theme) => {
		return renderToolCallLines(formatMcpDirectToolCallLines(displayName, args), theme);
	};
}
function blockToLines(block) {
	if (block.type === "text") return block.text.split("\n");
	return [`[image: ${block.mimeType}]`];
}
function formatMcpToolResultLines(result, expanded, maxCollapsedLines = 3) {
	const allLines = result.content.flatMap(blockToLines);
	const lines = allLines.length > 0 ? allLines : ["(empty result)"];
	if (expanded || lines.length <= maxCollapsedLines) return {
		lines,
		truncated: false
	};
	return {
		lines: [...lines.slice(0, maxCollapsedLines), "…"],
		truncated: true
	};
}
function renderMcpToolResult(result, options, theme, context) {
	if (options.isPartial) return new Text(theme.fg("warning", "Running MCP tool..."), 0, 0);
	const hasErrorDetails = Boolean(result.details.error);
	const display = formatMcpToolResultLines(result, options.expanded || context?.isError === true || hasErrorDetails);
	return new Text(`${display.lines.map((line) => line === "…" ? theme.fg("muted", line) : theme.fg("toolOutput", line)).join("\n")}${display.truncated && !options.expanded ? `\n${theme.fg("muted", "(Ctrl+O to expand)")}` : ""}`, 0, 0);
}
//#endregion
export { createMcpDirectToolCallRenderer, formatMcpDirectToolCallLines, formatMcpProxyToolCallLines, formatMcpToolResultLines, renderMcpProxyToolCall, renderMcpToolResult };
