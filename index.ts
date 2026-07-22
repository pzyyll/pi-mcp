// ABOUTME: Pi extension factory for the MCP adapter (thin cold-start entry).
// ABOUTME: Heavy runtime modules load on first use via dynamic import trampolines.
import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.ts";
import type { DirectToolSpec } from "./types.ts";
import { loadMcpConfig } from "./config.ts";
import {
  buildProxyDescription,
  getMissingConfiguredDirectToolServers,
  resolveDirectTools,
} from "./direct-tools-resolve.ts";
import { buildDirectToolParameters, buildProxyToolParameters } from "./direct-tool-register.ts";
import { loadMetadataCache } from "./metadata-cache.ts";
import { getConfigPathFromArgv, truncateAtWord } from "./utils.ts";
import { createMcpDirectToolCallRenderer, renderMcpProxyToolCall, renderMcpToolResult } from "./tool-result-renderer.ts";
import { toolErrorOverride } from "./error-signal.ts";

type DirectToolExecutor = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
  ctx: ExtensionContext,
) => Promise<unknown>;

function createDirectToolTrampoline(
  getState: () => McpExtensionState | null,
  getInitPromise: () => Promise<McpExtensionState> | null,
  spec: DirectToolSpec,
): DirectToolExecutor {
  let executorPromise: Promise<DirectToolExecutor> | null = null;
  return async (toolCallId, params, signal, onUpdate, ctx) => {
    if (!executorPromise) {
      executorPromise = import("./direct-tools.ts").then((mod) =>
        mod.createDirectToolExecutor(getState, getInitPromise, spec) as DirectToolExecutor,
      );
    }
    const executor = await executorPromise;
    return executor(toolCallId, params, signal, onUpdate, ctx);
  };
}

export default function mcpAdapter(pi: ExtensionAPI) {
  let state: McpExtensionState | null = null;
  let initPromise: Promise<McpExtensionState> | null = null;
  let lifecycleGeneration = 0;

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) return;

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: unknown;
    try {
      const { flushMetadataCache } = await import("./init.ts");
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }

    try {
      await currentState.lifecycle.gracefulShutdown();
    } catch (error) {
      if (flushError) {
        console.error("MCP: graceful shutdown failed after metadata flush error", error);
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  const earlyConfigPath = getConfigPathFromArgv();
  const earlyConfig = loadMcpConfig(earlyConfigPath);
  const earlyCache = loadMetadataCache();
  const prefix = earlyConfig.settings?.toolPrefix ?? "server";

  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const directSpecs = envRaw === "__none__"
    ? []
    : resolveDirectTools(
        earlyConfig,
        earlyCache,
        prefix,
        envRaw?.split(",").map(s => s.trim()).filter(Boolean),
      );
  const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
  const shouldRegisterProxyTool =
    earlyConfig.settings?.disableProxyTool !== true
    || directSpecs.length === 0
    || missingConfiguredDirectToolServers.length > 0;

  for (const spec of directSpecs) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: buildDirectToolParameters(spec.inputSchema),
      execute: createDirectToolTrampoline(() => state, () => initPromise, spec),
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName),
      renderResult: renderMcpToolResult,
    });
  }

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    state = null;
    initPromise = null;

    try {
      const { shutdownOAuth } = await import("./mcp-auth-flow.ts");
      await Promise.all([
        shutdownState(previousState, "session_restart"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: failed to shut down previous session state", error);
    }

    if (generation !== lifecycleGeneration) {
      return;
    }

    const { initializeOAuth } = await import("./mcp-auth-flow.ts");
    await initializeOAuth().catch(err => {
      console.error("MCP OAuth initialization failed:", err);
    });

    const { initializeMcp, updateStatusBar } = await import("./init.ts");
    const promise = initializeMcp(pi, ctx);
    initPromise = promise;

    promise.then(async (nextState) => {
      if (generation !== lifecycleGeneration || initPromise !== promise) {
        try {
          await shutdownState(nextState, "stale_session_start");
        } catch (error) {
          console.error("MCP: failed to clean stale session state", error);
        }
        return;
      }

      state = nextState;
      updateStatusBar(nextState);
      initPromise = null;
    }).catch(err => {
      if (generation !== lifecycleGeneration) {
        return;
      }
      if (initPromise !== promise && initPromise !== null) {
        return;
      }
      console.error("MCP initialization failed:", err);
      initPromise = null;
    });
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    state = null;
    initPromise = null;

    try {
      const { shutdownOAuth } = await import("./mcp-auth-flow.ts");
      await Promise.all([
        shutdownState(currentState, "session_shutdown"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: session shutdown cleanup failed", error);
    }
  });

  // Re-flag returned MCP tool failures so pi registers them as errors (see toolErrorOverride).
  pi.on("tool_result", (event) => toolErrorOverride(event.details));

  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    handler: async (args, ctx) => {
      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const {
        showStatus,
        showTools,
        reconnectServers,
        logoutServer,
        openMcpPanel,
        openMcpSetup,
      } = await import("./commands.ts");

      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "reconnect":
          await reconnectServers(state, ctx, targetServer);
          break;
        case "tools":
          await showTools(state, ctx);
          break;
        case "setup": {
          const result = await openMcpSetup(state, pi, ctx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            await ctx.reload();
            return;
          }
          break;
        }
        case "logout": {
          const serverName = rest;
          if (!serverName) {
            if (ctx.hasUI) ctx.ui.notify("Usage: /mcp logout <server>", "error");
            return;
          }
          await logoutServer(serverName, state, ctx);
          break;
        }
        case "status":
        case "":
        default:
          if (ctx.hasUI) {
            const result = await openMcpPanel(state, pi, ctx, earlyConfigPath);
            if (result?.configChanged) {
              await ctx.reload();
              return;
            }
          } else {
            await showStatus(state, ctx);
          }
          break;
      }
    },
  });

  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const serverName = args?.trim();
      if (!serverName && !ctx.hasUI) {
        return;
      }

      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const { authenticateServer, openMcpAuthPanel } = await import("./commands.ts");

      if (!serverName) {
        await openMcpAuthPanel(state, pi, ctx, earlyConfigPath);
        return;
      }

      await authenticateServer(serverName, state.config, ctx);
    },
  });

  if (shouldRegisterProxyTool) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: "mcp",
      label: "MCP",
      description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
      promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
      renderCall: renderMcpProxyToolCall,
      parameters: buildProxyToolParameters(),
      renderResult: renderMcpToolResult,
      async execute(
        _toolCallId: string,
        params: {
          tool?: string;
          args?: string;
          connect?: string;
          describe?: string;
          search?: string;
          regex?: boolean;
          includeSchemas?: boolean;
          server?: string;
          action?: string;
        },
        signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
        _ctx: ExtensionContext,
      ) {
        let parsedArgs: Record<string, unknown> | undefined;
        if (params.args) {
          try {
            parsedArgs = JSON.parse(params.args);
            if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
              const gotType = Array.isArray(parsedArgs) ? "array" : parsedArgs === null ? "null" : typeof parsedArgs;
              throw new Error(`Invalid args: expected a JSON object, got ${gotType}`);
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
            }
            throw error;
          }
        }

        if (!state && initPromise) {
          try {
            state = await initPromise;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { error: "not_initialized" },
          };
        }

        const proxyModes = await import("./proxy-modes.ts");

        if (params.action === "ui-messages") {
          return proxyModes.executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })" }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return proxyModes.executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return proxyModes.executeAuthComplete(state, params.server, input);
        }
        if (params.tool) {
          return proxyModes.executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.connect) {
          return proxyModes.executeConnect(state, params.connect, signal);
        }
        if (params.describe) {
          return proxyModes.executeDescribe(state, params.describe);
        }
        if (params.search) {
          return proxyModes.executeSearch(state, params.search, params.regex, params.server, params.includeSchemas);
        }
        if (params.server) {
          return proxyModes.executeList(state, params.server);
        }
        return proxyModes.executeStatus(state);
      },
    });
  }
}
