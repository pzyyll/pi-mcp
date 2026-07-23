import { C as logger, S as getVisualizationStreamEnvelope, T as wrapError, l as extractUiPromptText, w as ServerError } from "./init.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildAllowAttribute } from "@modelcontextprotocol/ext-apps/app-bridge";
import fs from "node:fs/promises";
import http from "node:http";
//#region src/host-html-template.ts
const DEFAULT_APP_BRIDGE_MODULE_URL = "/app-bridge.bundle.js";
function buildHostHtmlTemplate(input) {
	const hostContext = input.hostContext ?? {};
	const sessionToken = safeInlineJSON(input.sessionToken);
	const toolArgs = safeInlineJSON(input.toolArgs);
	const serverName = safeInlineJSON(input.serverName);
	const toolName = safeInlineJSON(input.toolName);
	const hostContextJson = safeInlineJSON(hostContext);
	const allowAttribute = safeInlineJSON(input.allowAttribute);
	const requireToolConsent = safeInlineJSON(input.requireToolConsent);
	const cacheToolConsent = safeInlineJSON(input.cacheToolConsent);
	const moduleUrl = safeInlineJSON(input.appBridgeModuleUrl ?? DEFAULT_APP_BRIDGE_MODULE_URL);
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCP UI - ${escapeHtml(input.serverName)} / ${escapeHtml(input.toolName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1115;
      --surface: #181c22;
      --text: #ecf0f5;
      --muted: #a9b2bf;
      --accent: #43c0ff;
      --border: rgba(255, 255, 255, 0.12);
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f6f7fb;
        --surface: #ffffff;
        --text: #1d2939;
        --muted: #667085;
        --accent: #0ea5e9;
        --border: rgba(15, 23, 42, 0.14);
        --good: #059669;
        --warn: #b45309;
        --bad: #b91c1c;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    body { display: flex; flex-direction: column; min-height: 100vh; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .title { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
    .server { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
    .tool { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; font-size: 11px; color: var(--muted); white-space: nowrap; }
    .controls { display: flex; gap: 8px; align-items: center; }
    .status { font-size: 12px; color: var(--muted); white-space: nowrap; }
    button { border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
    button.primary { border-color: color-mix(in srgb, var(--good) 40%, var(--border) 60%); color: var(--good); }
    button.danger { border-color: color-mix(in srgb, var(--bad) 40%, var(--border) 60%); color: var(--bad); }
    button:hover { background: color-mix(in srgb, var(--surface) 75%, var(--accent) 25%); }
    main { flex: 1; min-height: 0; padding: 10px; display: flex; }
    iframe { width: 100%; height: 100%; border: 1px solid var(--border); border-radius: 10px; background: white; }
    .overlay { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg) 90%, black 10%); display: none; align-items: center; justify-content: center; z-index: 2; }
    .overlay.visible { display: flex; }
    .panel { width: min(680px, calc(100vw - 40px)); background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
    .panel h2 { margin: 0 0 8px; font-size: 16px; }
    .panel p { margin: 0; color: var(--muted); line-height: 1.4; font-size: 14px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <div class="title">
      <span class="server">MCP · <span id="server-name"></span></span>
      <span class="tool" id="tool-name"></span>
      <span class="badge">Sandboxed</span>
    </div>
    <div class="controls">
      <span class="status" id="status">Loading UI...</span>
      <button class="primary" id="done-btn" title="Cmd/Ctrl+Enter">Done</button>
      <button class="danger" id="cancel-btn" title="Escape">Cancel</button>
    </div>
  </header>
  <main>
    <iframe id="mcp-app" referrerpolicy="no-referrer"></iframe>
  </main>
  <div class="overlay" id="error-overlay">
    <div class="panel">
      <h2>UI Error</h2>
      <p id="error-message"></p>
    </div>
  </div>
  <script type="module">
    import { AppBridge, PostMessageTransport } from ${moduleUrl};

    const SESSION_TOKEN = ${sessionToken};
    const SERVER_NAME = ${serverName};
    const TOOL_NAME = ${toolName};
    const TOOL_ARGS = ${toolArgs};
    const HOST_CONTEXT = ${hostContextJson};
    const ALLOW_ATTRIBUTE = ${allowAttribute};
    const REQUIRE_TOOL_CONSENT = ${requireToolConsent};
    const CACHE_TOOL_CONSENT = ${cacheToolConsent};
    const STREAM_CONTEXT_KEY = "pi-mcp-adapter/stream";
    const STREAM_PATCH_METHOD = "notifications/pi-mcp-adapter/ui-result-patch";

    const iframe = document.getElementById("mcp-app");
    const statusNode = document.getElementById("status");
    const doneBtn = document.getElementById("done-btn");
    const cancelBtn = document.getElementById("cancel-btn");
    const errorOverlay = document.getElementById("error-overlay");
    const errorMessage = document.getElementById("error-message");

    document.getElementById("server-name").textContent = SERVER_NAME;
    document.getElementById("tool-name").textContent = TOOL_NAME;

    const setStatus = (text, isError = false) => {
      statusNode.textContent = text;
      statusNode.style.color = isError ? "var(--bad)" : "var(--muted)";
    };

    const showError = (message) => {
      errorMessage.textContent = message;
      errorOverlay.classList.add("visible");
      setStatus("Error", true);
    };

    const post = async (endpoint, params) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: SESSION_TOKEN, params }),
      });

      const body = await response.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
      if (!response.ok || !body.ok) {
        const message = body.error || ("HTTP " + response.status);
        throw new Error(message);
      }
      return body.result ?? {};
    };

    let consentGranted = !REQUIRE_TOOL_CONSENT;
    const initialStreamContext = HOST_CONTEXT?.[STREAM_CONTEXT_KEY];
    const streamMode = initialStreamContext?.mode === "stream-first" ? "stream-first" : "eager";

    const bridge = new AppBridge(
      null,
      { name: "pi", version: "1.0.0" },
      { serverTools: {}, openLinks: {}, logging: {}, updateModelContext: {}, message: {} },
      { hostContext: HOST_CONTEXT }
    );

    bridge.oncalltool = async (params) => {
      if (!consentGranted) {
        const accepted = window.confirm("Allow this UI to call server tools for this session?");
        if (!accepted) {
          await post("/proxy/ui/consent", { approved: false }).catch(() => {});
          return {
            isError: true,
            content: [{ type: "text", text: "Tool call denied by user." }],
          };
        }
        await post("/proxy/ui/consent", { approved: true });
        if (CACHE_TOOL_CONSENT) {
          consentGranted = true;
        }
      }
      const result = await post("/proxy/tools/call", params);
      // Notify agent about the tool call
      await post("/proxy/ui/message", {
        type: "intent",
        intent: "call_tool",
        params: { tool: params.name, arguments: params.arguments, isError: result.isError }
      }).catch(() => {});
      return result;
    };

    bridge.onmessage = async (params) => post("/proxy/ui/message", params);
    bridge.onupdatemodelcontext = async (params) => post("/proxy/ui/context", params);
    
    // Also listen for raw postMessage events with custom types (notify, prompt, intent, etc.)
    // These bypass the AppBridge protocol but are used by some MCP UI implementations
    window.addEventListener("message", async (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      
      // Skip AppBridge protocol messages (handled by bridge)
      if (data.jsonrpc || (typeof data.method === "string" && (data.method.startsWith("app/") || data.method.startsWith("host/")))) return;
      
      // Handle raw UI action messages
      const msgType = data.type;
      if (typeof msgType !== "string") return;
      
      if (msgType === "notify" || msgType === "prompt" || msgType === "intent" || msgType === "message") {
        // Standard MCP-UI types - preserve their semantics
        // Support both { type, payload: {...} } and { type, field: value } formats
        const { type: _, payload, ...directFields } = data;
        await post("/proxy/ui/message", { type: msgType, ...directFields, ...(payload || {}) }).catch(() => {});
      } else if (!msgType.startsWith("ui-lifecycle-") && !msgType.startsWith("ui-message-")) {
        // Any other custom type - forward as intent with type as intent name
        // (Skip internal lifecycle/ack messages)
        const payload = data.payload || {};
        await post("/proxy/ui/message", {
          type: "intent",
          intent: msgType,
          params: payload,
        }).catch(() => {});
      }
    });
    bridge.ondownloadfile = async (params) => post("/proxy/ui/download-file", params);
    bridge.onrequestdisplaymode = async (params) => post("/proxy/ui/request-display-mode", params);
    bridge.onopenlink = async (params) => {
      const result = await post("/proxy/ui/open-link", params);
      if (!result.isError) {
        window.open(params.url, "_blank", "noopener,noreferrer");
        // Notify agent about the link open
        await post("/proxy/ui/message", {
          type: "intent",
          intent: "open_link",
          params: { url: params.url }
        }).catch(() => {});
      }
      return result;
    };

    bridge.oninitialized = () => {
      if (streamMode !== "stream-first") {
        bridge.sendToolInput({ arguments: TOOL_ARGS });
      }
      setStatus(streamMode === "stream-first" ? "Streaming…" : "Connected");
    };

    bridge.onsizechange = ({ width, height }) => {
      if (typeof width === "number" && width > 0) {
        iframe.style.minWidth = Math.min(width, window.innerWidth - 24) + "px";
      }
      if (typeof height === "number" && height > 0) {
        iframe.style.height = Math.max(height, 320) + "px";
      }
    };

    if (ALLOW_ATTRIBUTE) {
      iframe.setAttribute("allow", ALLOW_ATTRIBUTE);
    }

    // Connect bridge BEFORE loading iframe to ensure we're listening when the app sends ui/initialize
    try {
      const transport = new PostMessageTransport(iframe.contentWindow, null);
      await bridge.connect(transport);
    } catch (error) {
      console.error("[host] Bridge connection failed:", error);
      showError("Failed to initialize AppBridge: " + String(error));
    }

    const iframeLoaded = new Promise((resolve) => {
      iframe.onload = resolve;
    });
    iframe.src = "/ui-app?session=" + encodeURIComponent(SESSION_TOKEN);
    await iframeLoaded;

    const eventSource = new EventSource("/events?session=" + encodeURIComponent(SESSION_TOKEN));
    eventSource.addEventListener("tool-input", (event) => {
      try {
        bridge.sendToolInput(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward tool input: " + String(error));
      }
    });
    eventSource.addEventListener("tool-result", (event) => {
      try {
        bridge.sendToolResult(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward tool result: " + String(error));
      }
    });
    eventSource.addEventListener("tool-cancelled", (event) => {
      try {
        bridge.sendToolCancelled(JSON.parse(event.data));
      } catch (error) {
        showError("Failed to forward cancellation: " + String(error));
      }
    });
    eventSource.addEventListener("result-patch", async (event) => {
      try {
        await bridge.notification({
          method: STREAM_PATCH_METHOD,
          params: JSON.parse(event.data),
        });
      } catch (error) {
        showError("Failed to forward stream patch: " + String(error));
      }
    });
    eventSource.addEventListener("host-context", (event) => {
      try {
        bridge.setHostContext(JSON.parse(event.data));
      } catch {}
    });
    eventSource.addEventListener("session-complete", async () => {
      await bridge.teardownResource({}).catch(() => {});
      eventSource.close();
      window.close();
    });
    eventSource.onerror = () => {
      setStatus("Connection lost", true);
    };

    const heartbeat = setInterval(() => {
      post("/proxy/ui/heartbeat", {}).catch(() => {});
    }, 10000);

    const complete = async (reason) => {
      try {
        await post("/proxy/ui/complete", { reason });
      } catch {}
      try {
        await bridge.teardownResource({});
      } catch {}
      clearInterval(heartbeat);
      eventSource.close();
      window.close();
    };

    doneBtn.addEventListener("click", () => complete("done"));
    cancelBtn.addEventListener("click", () => complete("cancel"));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete("cancel");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        complete("done");
      }
    });
  <\/script>
</body>
</html>`;
}
function buildCspMetaContent(csp) {
	if (!csp) return void 0;
	const directives = [];
	directives.push("default-src 'none'");
	const scriptSrc = toDirective("script-src", csp.scriptDomains);
	const styleSrc = toDirective("style-src", csp.styleDomains);
	const fontSrc = toDirective("font-src", csp.fontDomains);
	const imgSrc = toDirective("img-src", csp.imgDomains);
	const mediaSrc = toDirective("media-src", csp.mediaDomains);
	const connectSrc = toDirective("connect-src", csp.connectDomains);
	const frameSrc = toDirective("frame-src", csp.frameDomains);
	const workerSrc = toDirective("worker-src", csp.workerDomains);
	const baseUri = toDirective("base-uri", csp.baseUriDomains);
	if (scriptSrc) directives.push(scriptSrc);
	if (styleSrc) directives.push(styleSrc);
	if (fontSrc) directives.push(fontSrc);
	if (imgSrc) directives.push(imgSrc);
	if (mediaSrc) directives.push(mediaSrc);
	if (connectSrc) directives.push(connectSrc);
	if (frameSrc) directives.push(frameSrc);
	if (workerSrc) directives.push(workerSrc);
	if (baseUri) directives.push(baseUri);
	return directives.join("; ");
}
function toDirective(name, domains) {
	if (!domains || domains.length === 0) return null;
	return `${name} ${domains.join(" ")}`;
}
function applyCspMeta(html, cspContent) {
	if (!cspContent) return html;
	if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
	const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(cspContent)}">`;
	if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${metaTag}`);
	return `${metaTag}\n${html}`;
}
function safeInlineJSON(value) {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeHtmlAttribute(value) {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
//#endregion
//#region src/ui-server.ts
const MAX_BODY_SIZE = 2 * 1024 * 1024;
const ABANDONED_GRACE_MS = 6e4;
const WATCHDOG_INTERVAL_MS = 5e3;
const MAX_EVENT_LOG = 128;
async function startUiServer(options) {
	const sessionToken = options.sessionToken ?? randomUUID();
	const log = logger.child({
		component: "UiServer",
		server: options.serverName,
		tool: options.toolName,
		session: sessionToken.slice(0, 8)
	});
	log.debug("Starting UI server");
	const sseClients = /* @__PURE__ */ new Set();
	let completed = false;
	let lastHeartbeatAt = Date.now();
	let watchdog = null;
	let currentDisplayMode = options.hostContext?.displayMode ?? "inline";
	let nextEventId = 1;
	const eventLog = [];
	let streamSummary;
	const sessionMessages = {
		prompts: [],
		notifications: [],
		intents: []
	};
	const hostContext = {
		displayMode: currentDisplayMode,
		availableDisplayModes: [
			"inline",
			"fullscreen",
			"pip"
		],
		platform: "desktop",
		...options.hostContext
	};
	const initialStreamContext = hostContext["pi-mcp-adapter/stream"];
	if (initialStreamContext && typeof initialStreamContext === "object") {
		const streamId = initialStreamContext.streamId;
		const mode = initialStreamContext.mode;
		if (typeof streamId === "string" && (mode === "eager" || mode === "stream-first")) streamSummary = {
			streamId,
			mode,
			frames: 0,
			phases: []
		};
	}
	const touchHeartbeat = () => {
		lastHeartbeatAt = Date.now();
	};
	const updateStreamSummary = (payload) => {
		const envelope = getVisualizationStreamEnvelope(payload?.structuredContent);
		if (!envelope) return;
		if (!streamSummary) streamSummary = {
			streamId: envelope.streamId,
			mode: "eager",
			frames: 0,
			phases: []
		};
		streamSummary.frames += 1;
		if (!streamSummary.phases.includes(envelope.phase)) streamSummary.phases.push(envelope.phase);
		streamSummary.finalStatus = envelope.status;
		streamSummary.lastMessage = envelope.message;
	};
	const serializeEvent = (eventId, name, payload) => {
		return `id: ${eventId}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
	};
	const getLatestCheckpointIndex = () => {
		for (let index = eventLog.length - 1; index >= 0; index -= 1) {
			const entry = eventLog[index];
			const envelope = getVisualizationStreamEnvelope(entry.payload?.structuredContent);
			if (envelope?.frameType === "checkpoint" || envelope?.frameType === "final") return index;
		}
		return -1;
	};
	const pruneEventLog = () => {
		if (eventLog.length <= MAX_EVENT_LOG) return;
		const latestCheckpointIndex = getLatestCheckpointIndex();
		if (latestCheckpointIndex > 0) eventLog.splice(0, latestCheckpointIndex);
		if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
	};
	const pushEvent = (name, payload) => {
		if (completed) return;
		const eventId = nextEventId++;
		eventLog.push({
			id: eventId,
			name,
			payload
		});
		updateStreamSummary(payload);
		pruneEventLog();
		const chunk = serializeEvent(eventId, name, payload);
		for (const client of sseClients) try {
			client.write(chunk);
		} catch {
			sseClients.delete(client);
		}
	};
	const replayEvents = (res, lastEventIdHeader) => {
		const parsedLastId = lastEventIdHeader ? Number(lastEventIdHeader) : NaN;
		const eventsToReplay = Number.isFinite(parsedLastId) ? eventLog.filter((entry) => entry.id > parsedLastId) : (() => {
			const latestCheckpointIndex = getLatestCheckpointIndex();
			return latestCheckpointIndex >= 0 ? eventLog.slice(latestCheckpointIndex) : eventLog;
		})();
		for (const entry of eventsToReplay) try {
			res.write(serializeEvent(entry.id, entry.name, entry.payload));
		} catch {
			sseClients.delete(res);
			return;
		}
	};
	const closeSse = () => {
		for (const client of sseClients) try {
			client.end();
		} catch {}
		sseClients.clear();
	};
	const stopWatchdog = () => {
		if (!watchdog) return;
		clearInterval(watchdog);
		watchdog = null;
	};
	const markCompleted = (reason) => {
		if (completed) return;
		log.debug("Session completed", { reason });
		pushEvent("session-complete", { reason });
		completed = true;
		stopWatchdog();
		options.onComplete?.(reason);
	};
	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
			if (method === "GET" && url.pathname === "/") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				touchHeartbeat();
				const html = buildHostHtmlTemplate({
					sessionToken,
					serverName: options.serverName,
					toolName: options.toolName,
					toolArgs: options.toolArgs,
					resource: options.resource,
					allowAttribute: buildAllowAttribute(options.resource.meta.permissions),
					requireToolConsent: options.consentManager.requiresPrompt(options.serverName),
					cacheToolConsent: options.consentManager.shouldCacheConsent(),
					hostContext
				});
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store"
				});
				res.end(html);
				return;
			}
			if (method === "GET" && url.pathname === "/events") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				touchHeartbeat();
				log.debug("SSE client connected", { clientCount: sseClients.size + 1 });
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no"
				});
				res.write(": connected\n\n");
				sseClients.add(res);
				replayEvents(res, req.headers["last-event-id"] ? String(req.headers["last-event-id"]) : null);
				req.on("close", () => {
					sseClients.delete(res);
				});
				return;
			}
			if (method === "GET" && url.pathname === "/health") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				sendJson(res, 200, {
					ok: true,
					result: { healthy: true }
				});
				return;
			}
			if (method === "GET" && url.pathname === "/ui-app") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				touchHeartbeat();
				const cspContent = buildCspMetaContent(options.resource.meta.csp);
				const appHtml = applyCspMeta(options.resource.html, cspContent);
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store"
				});
				res.end(appHtml);
				return;
			}
			if (method === "GET" && url.pathname === "/app-bridge.bundle.js") {
				const bundlePath = path.join(import.meta.dirname, "app-bridge.bundle.js");
				try {
					const content = await fs.readFile(bundlePath, "utf-8");
					res.writeHead(200, {
						"Content-Type": "application/javascript",
						"Cache-Control": "public, max-age=31536000"
					});
					res.end(content);
				} catch {
					sendJson(res, 500, {
						ok: false,
						error: "Bundle not found"
					});
				}
				return;
			}
			if (method !== "POST") {
				sendJson(res, 404, {
					ok: false,
					error: "Not found"
				});
				return;
			}
			const body = await parseBody(req, res);
			if (!body) return;
			if (!validateTokenBody(body, sessionToken, res)) return;
			const params = body.params ?? {};
			touchHeartbeat();
			if (url.pathname === "/proxy/tools/call") {
				options.consentManager.ensureApproved(options.serverName);
				const callParams = params;
				if (!callParams || typeof callParams.name !== "string" || !callParams.name.trim()) {
					sendJson(res, 400, {
						ok: false,
						error: "Invalid tools/call params"
					});
					return;
				}
				const connection = options.manager.getConnection(options.serverName);
				if (!connection || connection.status !== "connected") {
					sendJson(res, 503, {
						ok: false,
						error: `Server "${options.serverName}" is not connected`
					});
					return;
				}
				try {
					options.manager.touch(options.serverName);
					options.manager.incrementInFlight(options.serverName);
					sendJson(res, 200, {
						ok: true,
						result: await connection.client.callTool({
							name: callParams.name,
							arguments: callParams.arguments && typeof callParams.arguments === "object" && !Array.isArray(callParams.arguments) ? callParams.arguments : {}
						}, void 0, options.manager.getRequestOptions?.(options.serverName))
					});
				} finally {
					options.manager.decrementInFlight(options.serverName);
					options.manager.touch(options.serverName);
				}
				return;
			}
			if (url.pathname === "/proxy/ui/consent") {
				const approved = !!params.approved;
				options.consentManager.registerDecision(options.serverName, approved);
				sendJson(res, 200, {
					ok: true,
					result: { approved }
				});
				return;
			}
			if (url.pathname === "/proxy/ui/message") {
				const msgParams = params;
				const promptText = extractUiPromptText(msgParams);
				if (promptText) {
					sessionMessages.prompts.push(promptText);
					log.debug("UI prompt received", { prompt: promptText.slice(0, 100) });
				} else if (msgParams.type === "intent" || msgParams.intent) {
					const intentName = msgParams.intent ?? "";
					if (intentName) {
						sessionMessages.intents.push({
							intent: intentName,
							params: msgParams.params
						});
						log.debug("UI intent received", { intent: intentName });
					}
				} else if (msgParams.type === "notify" || msgParams.message) {
					const notifyText = msgParams.message ?? "";
					if (notifyText) {
						sessionMessages.notifications.push(notifyText);
						log.debug("UI notification", { message: notifyText.slice(0, 100) });
					}
				}
				await options.onMessage?.(msgParams);
				sendJson(res, 200, {
					ok: true,
					result: {}
				});
				return;
			}
			if (url.pathname === "/proxy/ui/context") {
				const ctxParams = params;
				log.debug("UI context update", { hasContent: !!ctxParams.content });
				await options.onContextUpdate?.(ctxParams);
				sendJson(res, 200, {
					ok: true,
					result: {}
				});
				return;
			}
			if (url.pathname === "/proxy/ui/open-link") {
				const openParams = params;
				if (!openParams?.url || typeof openParams.url !== "string") {
					sendJson(res, 400, {
						ok: false,
						error: "Invalid open-link params"
					});
					return;
				}
				let result = {};
				try {
					new URL(openParams.url);
				} catch {
					result = { isError: true };
				}
				sendJson(res, 200, {
					ok: true,
					result
				});
				return;
			}
			if (url.pathname === "/proxy/ui/download-file") {
				sendJson(res, 200, {
					ok: true,
					result: { isError: true }
				});
				return;
			}
			if (url.pathname === "/proxy/ui/request-display-mode") {
				const requested = params?.mode;
				const available = hostContext.availableDisplayModes ?? ["inline"];
				if (requested && available.includes(requested)) currentDisplayMode = requested;
				hostContext.displayMode = currentDisplayMode;
				pushEvent("host-context", { displayMode: currentDisplayMode });
				sendJson(res, 200, {
					ok: true,
					result: { mode: currentDisplayMode }
				});
				return;
			}
			if (url.pathname === "/proxy/ui/heartbeat") {
				sendJson(res, 200, {
					ok: true,
					result: {}
				});
				return;
			}
			if (url.pathname === "/proxy/ui/complete") {
				const reason = typeof params.reason === "string" ? params.reason : "done";
				markCompleted(reason);
				sendJson(res, 200, {
					ok: true,
					result: {}
				});
				setTimeout(() => {
					try {
						server.close();
					} catch {}
					closeSse();
				}, 20).unref();
				return;
			}
			sendJson(res, 404, {
				ok: false,
				error: "Not found"
			});
		} catch (error) {
			const wrapped = wrapError(error, {
				server: options.serverName,
				tool: options.toolName
			});
			const status = /approval required|denied/i.test(wrapped.message) ? 403 : 500;
			if (status === 500) log.error("Request handler error", error instanceof Error ? error : void 0);
			sendJson(res, status, {
				ok: false,
				error: wrapped.message
			});
		}
	});
	if (options.initialResultPromise) options.initialResultPromise.then((result) => pushEvent("tool-result", result), (error) => {
		const reason = error instanceof Error ? error.message : String(error);
		pushEvent("tool-cancelled", { reason });
	});
	watchdog = setInterval(() => {
		if (completed) return;
		if (Date.now() - lastHeartbeatAt <= ABANDONED_GRACE_MS) return;
		markCompleted("stale");
		try {
			server.close();
		} catch {}
		closeSse();
	}, WATCHDOG_INTERVAL_MS);
	watchdog.unref();
	return new Promise((resolve, reject) => {
		const onError = (error) => {
			log.error("Failed to start server", error);
			reject(new ServerError(error.message, {
				port: options.port,
				cause: error
			}));
		};
		server.once("error", onError);
		server.listen(options.port ?? 0, "127.0.0.1", () => {
			server.off("error", onError);
			const address = server.address();
			if (!address || typeof address === "string") {
				const err = new ServerError("invalid address");
				log.error("Invalid server address", err);
				reject(err);
				return;
			}
			log.debug("Server started", { port: address.port });
			resolve({
				url: `http://localhost:${address.port}/?session=${sessionToken}`,
				port: address.port,
				sessionToken,
				serverName: options.serverName,
				toolName: options.toolName,
				close: (reason) => {
					markCompleted(reason ?? "closed");
					try {
						server.close();
					} catch {}
					closeSse();
				},
				sendToolInput: (args) => {
					pushEvent("tool-input", { arguments: args });
				},
				sendToolResult: (result) => {
					pushEvent("tool-result", result);
				},
				sendResultPatch: (result) => {
					pushEvent("result-patch", result);
				},
				sendToolCancelled: (reason) => {
					pushEvent("tool-cancelled", { reason });
				},
				sendHostContext: (context) => {
					Object.assign(hostContext, context);
					pushEvent("host-context", context);
				},
				getSessionMessages: () => ({ ...sessionMessages }),
				getStreamSummary: () => streamSummary ? {
					...streamSummary,
					phases: [...streamSummary.phases]
				} : void 0
			});
		});
	});
}
async function parseBody(req, res) {
	try {
		const body = await readBody(req);
		if (!body || typeof body !== "object") {
			sendJson(res, 400, {
				ok: false,
				error: "Invalid request body"
			});
			return null;
		}
		return body;
	} catch (error) {
		sendJson(res, 400, {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid body"
		});
		return null;
	}
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(/* @__PURE__ */ new Error("Request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
function validateTokenQuery(url, expected, res) {
	if (url.searchParams.get("session") !== expected) {
		sendJson(res, 403, {
			ok: false,
			error: "Invalid session"
		});
		return false;
	}
	return true;
}
function validateTokenBody(body, expected, res) {
	if (body.token !== expected) {
		sendJson(res, 403, {
			ok: false,
			error: "Invalid session"
		});
		return false;
	}
	return true;
}
function sendJson(res, status, payload) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(payload));
}
//#endregion
export { startUiServer };
