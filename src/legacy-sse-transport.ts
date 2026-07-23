// ABOUTME: Isolated factory for deprecated MCP SSE client transport.
// ABOUTME: StreamableHTTP is preferred; SSE remains a connect fallback for legacy servers.
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** Constructor shape used only for the legacy SSE connect fallback. */
type LegacySseTransportConstructor = new (
  url: URL,
  options?: {
    requestInit?: RequestInit;
    authProvider?: unknown;
  },
) => Transport;

/**
 * Build a legacy SSE transport after Streamable HTTP probing fails.
 *
 * MCP TypeScript SDK deprecates `SSEClientTransport` in favor of
 * `StreamableHTTPClientTransport`, but still documents dual-transport support
 * during migration because some servers only speak SSE.
 *
 * The module is loaded dynamically and cast to a local constructor type so our
 * compile surface does not reference the deprecated class symbol directly.
 */
export async function createLegacySseClientTransport(
  url: URL,
  options: {
    requestInit?: RequestInit;
    authProvider?: unknown;
  },
): Promise<Transport> {
  const sseModule = (await import("@modelcontextprotocol/sdk/client/sse.js")) as {
    SSEClientTransport: LegacySseTransportConstructor;
  };
  return new sseModule.SSEClientTransport(url, options);
}
