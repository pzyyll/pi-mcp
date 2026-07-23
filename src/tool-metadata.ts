// ABOUTME: Builds and queries MCP tool metadata (names, schemas, UI resource URIs).
// ABOUTME: Re-exports formatSchema for back-compat; pure schema formatting lives in schema-format.ts.
import type { McpExtensionState } from "./state.ts";
import type { ToolMetadata, McpTool, McpResource, ServerEntry } from "./types.ts";
import { formatToolName, isToolExcluded } from "./types.ts";
import { resourceNameToToolName } from "./resource-tools.ts";
import { extractToolUiStreamMode } from "./utils.ts";
import { getToolUiResourceUri } from "./tool-ui-uri.ts";

export { formatSchema } from "./schema-format.ts";

export function buildToolMetadata(
  tools: McpTool[],
  resources: McpResource[],
  definition: ServerEntry,
  serverName: string,
  prefix: "server" | "none" | "short",
): { metadata: ToolMetadata[]; failedTools: string[] } {
  const metadata: ToolMetadata[] = [];
  const failedTools: string[] = [];

  for (const tool of tools) {
    if (!tool?.name) {
      failedTools.push("(unnamed)");
      continue;
    }
    if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) {
      continue;
    }

    let uiResourceUri: string | undefined;
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
      uiStreamMode: extractToolUiStreamMode(tool._meta),
    });
  }

  if (definition.exposeResources !== false) {
    for (const resource of resources) {
      const baseName = `get_${resourceNameToToolName(resource.name)}`;
      if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) {
        continue;
      }

      metadata.push({
        name: formatToolName(baseName, serverName, prefix),
        originalName: baseName,
        description: resource.description ?? `Read resource: ${resource.uri}`,
        resourceUri: resource.uri,
      });
    }
  }

  return { metadata, failedTools };
}

export function getToolNames(state: McpExtensionState, serverName: string): string[] {
  return state.toolMetadata.get(serverName)?.map((m) => m.name) ?? [];
}

export function totalToolCount(state: McpExtensionState): number {
  let count = 0;
  for (const metadata of state.toolMetadata.values()) {
    count += metadata.length;
  }
  return count;
}

export function findToolByName(
  metadata: ToolMetadata[] | undefined,
  toolName: string,
): ToolMetadata | undefined {
  if (!metadata) return undefined;
  const exact = metadata.find((m) => m.name === toolName);
  if (exact) return exact;
  const normalized = toolName.replace(/-/g, "_");
  return metadata.find((m) => m.name.replace(/-/g, "_") === normalized);
}
