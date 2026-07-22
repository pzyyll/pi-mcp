// ABOUTME: Unit tests for light direct-tool resolve helpers (no MCP SDK graph).
// ABOUTME: Covers resolve mapping from cache fixtures and missing-server detection.
import { describe, expect, it } from "vitest";
import {
  buildProxyDescription,
  getMissingConfiguredDirectToolServers,
  resolveDirectTools,
} from "../src/direct-tools-resolve.ts";
import { computeServerHash, type MetadataCache } from "../src/metadata-cache.ts";
import type { McpConfig } from "../src/types.ts";

describe("direct-tools-resolve", () => {
  it("exports resolve helpers used by the factory path", () => {
    expect(typeof resolveDirectTools).toBe("function");
    expect(typeof getMissingConfiguredDirectToolServers).toBe("function");
    expect(typeof buildProxyDescription).toBe("function");
  });

  it("maps valid cache tools into direct tool specs", () => {
    const definition = {
      command: "npx",
      args: ["-y", "demo-server"],
      directTools: true as const,
    };
    const config: McpConfig = {
      mcpServers: {
        demo: definition,
      },
    };
    const cache: MetadataCache = {
      version: 1,
      servers: {
        demo: {
          configHash: computeServerHash(definition),
          cachedAt: Date.now(),
          tools: [
            {
              name: "search",
              description: "Search demo records",
              inputSchema: { type: "object", properties: { q: { type: "string" } } },
            },
          ],
          resources: [],
        },
      },
    };

    const specs = resolveDirectTools(config, cache, "server");
    expect(specs).toEqual([
      expect.objectContaining({
        serverName: "demo",
        originalName: "search",
        prefixedName: "demo_search",
        description: "Search demo records",
      }),
    ]);
    expect(getMissingConfiguredDirectToolServers(config, cache)).toEqual([]);
  });

  it("reports configured direct-tool servers missing from cache", () => {
    const config: McpConfig = {
      mcpServers: {
        demo: {
          command: "npx",
          args: ["-y", "demo-server"],
          directTools: true,
        },
      },
    };

    expect(getMissingConfiguredDirectToolServers(config, null)).toEqual(["demo"]);
    expect(buildProxyDescription(config, null, []).includes("MCP gateway")).toBe(true);
  });
});
