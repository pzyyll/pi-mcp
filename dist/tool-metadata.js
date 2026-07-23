import { formatToolName, isToolExcluded } from "./types.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { extractToolUiStreamMode } from "./utils.js";
import { getToolUiResourceUri } from "./tool-ui-uri.js";
import { formatSchema } from "./schema-format.js";
//#region src/tool-metadata.ts
function buildToolMetadata(tools, resources, definition, serverName, prefix) {
	const metadata = [];
	const failedTools = [];
	for (const tool of tools) {
		if (!tool?.name) {
			failedTools.push("(unnamed)");
			continue;
		}
		if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) continue;
		let uiResourceUri;
		try {
			uiResourceUri = getToolUiResourceUri({ _meta: tool._meta });
		} catch {
			failedTools.push(tool.name);
		}
		metadata.push({
			name: formatToolName(tool.name, serverName, prefix),
			originalName: tool.name,
			description: tool.description ?? "",
			inputSchema: tool.inputSchema,
			uiResourceUri,
			uiStreamMode: extractToolUiStreamMode(tool._meta)
		});
	}
	if (definition.exposeResources !== false) for (const resource of resources) {
		const baseName = `get_${resourceNameToToolName(resource.name)}`;
		if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) continue;
		metadata.push({
			name: formatToolName(baseName, serverName, prefix),
			originalName: baseName,
			description: resource.description ?? `Read resource: ${resource.uri}`,
			resourceUri: resource.uri
		});
	}
	return {
		metadata,
		failedTools
	};
}
function getToolNames(state, serverName) {
	return state.toolMetadata.get(serverName)?.map((m) => m.name) ?? [];
}
function totalToolCount(state) {
	let count = 0;
	for (const metadata of state.toolMetadata.values()) count += metadata.length;
	return count;
}
function findToolByName(metadata, toolName) {
	if (!metadata) return void 0;
	const exact = metadata.find((m) => m.name === toolName);
	if (exact) return exact;
	const normalized = toolName.replace(/-/g, "_");
	return metadata.find((m) => m.name.replace(/-/g, "_") === normalized);
}
//#endregion
export { buildToolMetadata, findToolByName, formatSchema, getToolNames, totalToolCount };
