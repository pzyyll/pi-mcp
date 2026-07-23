import { ServerError, wrapError } from "./errors.js";
import { logger } from "./logger.js";
import { getVisualizationStreamEnvelope } from "./ui-stream-types.js";
import { extractUiPromptText } from "./types.js";
import { applyCspMeta, buildCspMetaContent, buildHostHtmlTemplate } from "./host-html-template.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildAllowAttribute } from "@modelcontextprotocol/ext-apps/app-bridge";
import fs from "node:fs/promises";
import http from "node:http";
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
