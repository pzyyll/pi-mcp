//#region src/tool-registrar.ts
/**
* Transform MCP content types to Pi content blocks.
*/
function transformMcpContent(content) {
	return content.map((c) => {
		if (c.type === "text") return {
			type: "text",
			text: c.text ?? ""
		};
		if (c.type === "image") return {
			type: "image",
			data: c.data ?? "",
			mimeType: c.mimeType ?? "image/png"
		};
		if (c.type === "resource") return {
			type: "text",
			text: `[Resource: ${c.resource?.uri ?? "(no URI)"}]\n${c.resource?.text ?? (c.resource ? JSON.stringify(c.resource) : "(no content)")}`
		};
		if (c.type === "resource_link") return {
			type: "text",
			text: `[Resource Link: ${c.name ?? c.uri ?? "unknown"}]\nURI: ${c.uri ?? "(no URI)"}`
		};
		if (c.type === "audio") return {
			type: "text",
			text: `[Audio content: ${c.mimeType ?? "audio/*"}]`
		};
		return {
			type: "text",
			text: JSON.stringify(c)
		};
	});
}
/**
* Resolve a tool result's content blocks, falling back to structuredContent
* when content is empty.
*/
function resolveMcpResultContent(result) {
	const blocks = transformMcpContent(Array.isArray(result.content) ? result.content : []);
	if (blocks.length > 0) return blocks;
	if (result.structuredContent !== void 0 && result.structuredContent !== null) return [{
		type: "text",
		text: stringifyStructuredContent(result.structuredContent)
	}];
	return [];
}
function stringifyStructuredContent(value) {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}
//#endregion
export { resolveMcpResultContent, transformMcpContent };
