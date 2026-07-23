// ABOUTME: Light typebox-backed parameter builders for MCP tool registration.
// ABOUTME: Isolated so the factory can pay typebox cost without loading MCP SDK/auth/UI.

import { Type } from "typebox";
import { normalizeDirectToolInputSchema } from "./utils.ts";

export function buildDirectToolParameters(inputSchema: unknown) {
  return Type.Unsafe(normalizeDirectToolInputSchema(inputSchema) as never);
}

export function buildProxyToolParameters() {
  return Type.Object({
    tool: Type.Optional(
      Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" }),
    ),
    args: Type.Optional(
      Type.String({ description: 'Arguments as JSON string (e.g., \'{"key": "value"}\')' }),
    ),
    connect: Type.Optional(
      Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" }),
    ),
    describe: Type.Optional(
      Type.String({ description: "Tool name to describe (shows parameters)" }),
    ),
    search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
    regex: Type.Optional(
      Type.Boolean({ description: "Treat search as regex (default: substring match)" }),
    ),
    includeSchemas: Type.Optional(
      Type.Boolean({ description: "Include parameter schemas in search results (default: true)" }),
    ),
    server: Type.Optional(
      Type.String({ description: "Filter to specific server (also disambiguates tool calls)" }),
    ),
    action: Type.Optional(
      Type.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" }),
    ),
  });
}
