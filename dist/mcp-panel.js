import { isToolExcluded } from "./types.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { createPanelKeys } from "./panel-keys.js";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
//#region src/mcp-panel.ts
const DEFAULT_THEME = {
	border: "2",
	title: "2",
	selected: "36",
	direct: "32",
	needsAuth: "33",
	placeholder: "2;3",
	description: "2",
	hint: "2",
	confirm: "32",
	cancel: "31"
};
function fg(code, text) {
	if (!code) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}
const RAINBOW_COLORS = [
	"38;2;178;129;214",
	"38;2;215;135;175",
	"38;2;254;188;56",
	"38;2;228;192;15",
	"38;2;137;210;129",
	"38;2;0;175;175",
	"38;2;23;143;185"
];
function rainbowProgress(filled, total) {
	const dots = [];
	for (let i = 0; i < total; i++) {
		const color = RAINBOW_COLORS[i % RAINBOW_COLORS.length];
		dots.push(fg(color, i < filled ? "●" : "○"));
	}
	return dots.join(" ");
}
function fuzzyScore(query, text) {
	const lq = query.toLowerCase();
	const lt = text.toLowerCase();
	if (lt.includes(lq)) return 100 + lq.length / lt.length * 50;
	let score = 0;
	let qi = 0;
	let consecutive = 0;
	for (let i = 0; i < lt.length && qi < lq.length; i++) if (lt[i] === lq[qi]) {
		score += 10 + consecutive;
		consecutive += 5;
		qi++;
	} else consecutive = 0;
	return qi === lq.length ? score : 0;
}
function sanitizeDisplayText(text) {
	return (text ?? "").replace(/(?:\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x9d[\s\S]*?(?:\x07|\x1b\\|\x9c))/g, "").replace(/(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_])/g, "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}
function sanitizeRowContent(content) {
	let result = "";
	let pendingSpace = false;
	for (let i = 0; i < content.length; i++) {
		const rest = content.slice(i);
		const osc = rest.match(/^(?:\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x9d[\s\S]*?(?:\x07|\x1b\\|\x9c))/);
		if (osc) {
			i += osc[0].length - 1;
			continue;
		}
		const ansi = rest.match(/^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_])/);
		if (ansi) {
			result += ansi[0];
			i += ansi[0].length - 1;
			continue;
		}
		const code = content.charCodeAt(i);
		if (code <= 31 || code === 127 || code >= 128 && code <= 159) {
			pendingSpace = true;
			continue;
		}
		if (pendingSpace && result && !result.endsWith(" ")) result += " ";
		pendingSpace = false;
		result += content[i];
	}
	return result;
}
function estimateTokens(tool) {
	const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
	const descLen = tool.description?.length ?? 0;
	return Math.ceil((tool.name.length + descLen + schemaLen) / 4) + 10;
}
var McpPanel = class McpPanel {
	callbacks;
	done;
	noticeLines;
	prefix;
	servers = [];
	cursorIndex = 0;
	nameQuery = "";
	descSearchActive = false;
	descQuery = "";
	dirty = false;
	confirmingDiscard = false;
	discardSelected = 1;
	importNotice = null;
	authNotice = null;
	authInFlight = null;
	inactivityTimeout = null;
	visibleItems = [];
	tui;
	t = DEFAULT_THEME;
	authOnly;
	keys;
	static MAX_VISIBLE = 12;
	static INACTIVITY_MS = 6e4;
	constructor(config, cache, provenance, callbacks, tui, done, options = {}) {
		this.callbacks = callbacks;
		this.done = done;
		this.tui = tui;
		this.noticeLines = options.noticeLines ?? [];
		this.authOnly = options.authOnly === true;
		this.keys = createPanelKeys(options.keybindings);
		this.prefix = config.settings?.toolPrefix ?? "server";
		for (const [serverName, definition] of Object.entries(config.mcpServers)) {
			if (this.authOnly && !callbacks.canAuthenticate(serverName)) continue;
			const prov = provenance.get(serverName);
			const serverCache = cache?.servers?.[serverName];
			const globalDirect = config.settings?.directTools;
			let toolFilter = false;
			if (definition.directTools !== void 0) toolFilter = definition.directTools;
			else if (globalDirect) toolFilter = globalDirect;
			const tools = [];
			if (serverCache && !this.authOnly) {
				for (const tool of serverCache.tools ?? []) {
					if (isToolExcluded(tool.name, serverName, this.prefix, definition.excludeTools)) continue;
					const isDirect = toolFilter === true || Array.isArray(toolFilter) && toolFilter.includes(tool.name);
					tools.push({
						name: tool.name,
						description: tool.description ?? "",
						isDirect,
						wasDirect: isDirect,
						estimatedTokens: estimateTokens(tool)
					});
				}
				if (definition.exposeResources !== false) for (const resource of serverCache.resources ?? []) {
					const baseName = `get_${resourceNameToToolName(resource.name)}`;
					if (isToolExcluded(baseName, serverName, this.prefix, definition.excludeTools)) continue;
					const isDirect = toolFilter === true || Array.isArray(toolFilter) && toolFilter.includes(baseName);
					const ct = {
						name: baseName,
						description: resource.description
					};
					tools.push({
						name: baseName,
						description: resource.description ?? `Read resource: ${resource.uri}`,
						isDirect,
						wasDirect: isDirect,
						estimatedTokens: estimateTokens(ct)
					});
				}
			}
			const status = callbacks.getConnectionStatus(serverName);
			this.servers.push({
				name: serverName,
				expanded: false,
				source: prov?.kind ?? "user",
				importKind: prov?.importKind,
				excludeTools: definition.excludeTools,
				exposeResources: definition.exposeResources !== false,
				connectionStatus: status,
				tools,
				hasCachedData: !!serverCache
			});
		}
		this.rebuildVisibleItems();
		this.resetInactivityTimeout();
	}
	resetInactivityTimeout() {
		if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
		this.inactivityTimeout = setTimeout(() => {
			this.cleanup();
			this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
		}, McpPanel.INACTIVITY_MS);
	}
	cleanup() {
		if (this.inactivityTimeout) {
			clearTimeout(this.inactivityTimeout);
			this.inactivityTimeout = null;
		}
	}
	rebuildVisibleItems() {
		const query = this.descSearchActive ? this.descQuery : this.nameQuery;
		const mode = this.descSearchActive ? "desc" : "name";
		this.visibleItems = [];
		for (let si = 0; si < this.servers.length; si++) {
			const server = this.servers[si];
			if (query && this.authOnly) {
				if ((mode === "name" ? fuzzyScore(query, server.name) : 0) > 0) this.visibleItems.push({
					type: "server",
					serverIndex: si
				});
				continue;
			}
			this.visibleItems.push({
				type: "server",
				serverIndex: si
			});
			if (server.expanded || query) for (let ti = 0; ti < server.tools.length; ti++) {
				const tool = server.tools[ti];
				if (query) {
					if ((mode === "name" ? Math.max(fuzzyScore(query, tool.name), fuzzyScore(query, server.name) * .6) : fuzzyScore(query, tool.description)) === 0) continue;
				}
				this.visibleItems.push({
					type: "tool",
					serverIndex: si,
					toolIndex: ti
				});
			}
		}
		if (query && !this.authOnly) this.visibleItems = this.visibleItems.filter((item) => {
			if (item.type === "server") return this.visibleItems.some((other) => other.type === "tool" && other.serverIndex === item.serverIndex);
			return true;
		});
	}
	updateDirty() {
		this.dirty = this.servers.some((s) => s.tools.some((t) => t.isDirect !== t.wasDirect));
	}
	buildResult() {
		const changes = /* @__PURE__ */ new Map();
		for (const server of this.servers) {
			if (!server.tools.some((t) => t.isDirect !== t.wasDirect)) continue;
			const directTools = server.tools.filter((t) => t.isDirect);
			if (directTools.length === server.tools.length && server.tools.length > 0) changes.set(server.name, true);
			else if (directTools.length === 0) changes.set(server.name, false);
			else changes.set(server.name, directTools.map((t) => t.name));
		}
		return {
			changes,
			cancelled: false
		};
	}
	handleInput(data) {
		this.resetInactivityTimeout();
		this.importNotice = null;
		if (!this.authInFlight) this.authNotice = null;
		if (this.confirmingDiscard) {
			this.handleDiscardInput(data);
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.cleanup();
			this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.cleanup();
			this.done(this.buildResult());
			return;
		}
		if (this.descSearchActive) {
			if (matchesKey(data, "escape") || this.keys.selectConfirm(data)) {
				this.descSearchActive = false;
				this.descQuery = "";
				this.rebuildVisibleItems();
				this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
				return;
			}
			if (matchesKey(data, "backspace")) {
				if (this.descQuery.length > 0) {
					this.descQuery = this.descQuery.slice(0, -1);
					this.rebuildVisibleItems();
					this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
				}
				return;
			}
			if (this.keys.selectUp(data)) {
				this.moveCursor(-1);
				return;
			}
			if (this.keys.selectDown(data)) {
				this.moveCursor(1);
				return;
			}
			if (matchesKey(data, "space")) {
				const item = this.visibleItems[this.cursorIndex];
				if (item) this.toggleItem(item);
				return;
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.descQuery += data;
				this.rebuildVisibleItems();
				this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
				return;
			}
			return;
		}
		if (matchesKey(data, "escape")) {
			if (this.nameQuery) {
				this.nameQuery = "";
				this.rebuildVisibleItems();
				this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
				return;
			}
			if (this.dirty) {
				this.confirmingDiscard = true;
				this.discardSelected = 1;
				return;
			}
			this.cleanup();
			this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
			return;
		}
		if (this.keys.selectUp(data)) {
			this.moveCursor(-1);
			return;
		}
		if (this.keys.selectDown(data)) {
			this.moveCursor(1);
			return;
		}
		if (matchesKey(data, "space")) {
			const item = this.visibleItems[this.cursorIndex];
			if (item && !this.authOnly) this.toggleItem(item);
			return;
		}
		if (this.keys.selectConfirm(data)) {
			const item = this.visibleItems[this.cursorIndex];
			if (!item) return;
			const server = this.servers[item.serverIndex];
			if (item.type === "server") {
				if (this.authOnly || server.connectionStatus === "needs-auth") {
					this.authenticateServer(server);
					return;
				}
				server.expanded = !server.expanded;
				this.rebuildVisibleItems();
				this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
			} else if (item.toolIndex !== void 0) {
				const tool = server.tools[item.toolIndex];
				tool.isDirect = !tool.isDirect;
				if (tool.isDirect && server.source === "import") this.importNotice = `Imported from ${sanitizeDisplayText(server.importKind ?? "external")} — will copy to user config on save`;
				this.updateDirty();
			}
			return;
		}
		if (matchesKey(data, "ctrl+a")) {
			const item = this.visibleItems[this.cursorIndex];
			if (item) this.authenticateSelectedServer(item);
			return;
		}
		if (matchesKey(data, "ctrl+r")) {
			const item = this.visibleItems[this.cursorIndex];
			if (!item) return;
			const server = this.servers[item.serverIndex];
			if (server.connectionStatus === "connecting") return;
			server.connectionStatus = "connecting";
			this.callbacks.reconnect(server.name).then(() => {
				server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
				if (server.connectionStatus === "connected") {
					const entry = this.callbacks.refreshCacheAfterReconnect(server.name);
					if (entry) this.rebuildServerTools(server, entry);
					server.hasCachedData = true;
				}
				this.tui.requestRender();
			}).catch((error) => {
				server.connectionStatus = "failed";
				const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
				const serverName = sanitizeDisplayText(server.name);
				this.authNotice = `Reconnect failed for ${serverName}: ${message}`;
				this.tui.requestRender();
			});
			return;
		}
		if (data === "?") {
			if (this.authOnly) return;
			this.descSearchActive = true;
			this.descQuery = "";
			this.rebuildVisibleItems();
			this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
			return;
		}
		if (matchesKey(data, "backspace")) {
			if (this.nameQuery.length > 0) {
				this.nameQuery = this.nameQuery.slice(0, -1);
				this.rebuildVisibleItems();
				this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
			}
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.nameQuery += data;
			this.rebuildVisibleItems();
			this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
			return;
		}
	}
	authenticateSelectedServer(item) {
		this.authenticateServer(this.servers[item.serverIndex]);
	}
	authenticateServer(server) {
		if (this.authInFlight) return;
		const serverName = sanitizeDisplayText(server.name);
		if (!this.callbacks.canAuthenticate(server.name)) {
			this.authNotice = `${serverName} does not use OAuth authentication.`;
			return;
		}
		this.authInFlight = server.name;
		this.authNotice = `Authenticating ${serverName}...`;
		this.tui.requestRender();
		this.callbacks.authenticate(server.name).then((result) => {
			server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
			const message = sanitizeDisplayText(result.message);
			this.authNotice = result.ok ? `OAuth finished for ${serverName}. Run reconnect if it is still idle.` : `OAuth failed for ${serverName}${message ? `: ${message}` : ". Check the notification for details."}`;
			this.authInFlight = null;
			this.tui.requestRender();
		}).catch((error) => {
			const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
			server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
			this.authNotice = `OAuth failed for ${serverName}: ${message}`;
			this.authInFlight = null;
			this.tui.requestRender();
		});
	}
	toggleItem(item) {
		if (this.authOnly) return;
		const server = this.servers[item.serverIndex];
		if (item.type === "server") {
			const newState = !server.tools.every((t) => t.isDirect);
			if (server.source === "import" && newState) this.importNotice = `Imported from ${sanitizeDisplayText(server.importKind ?? "external")} — will copy to user config on save`;
			for (const t of server.tools) t.isDirect = newState;
		} else if (item.toolIndex !== void 0) {
			const tool = server.tools[item.toolIndex];
			tool.isDirect = !tool.isDirect;
			if (tool.isDirect && server.source === "import") this.importNotice = `Imported from ${sanitizeDisplayText(server.importKind ?? "external")} — will copy to user config on save`;
		}
		this.updateDirty();
	}
	handleDiscardInput(data) {
		if (matchesKey(data, "ctrl+c")) {
			this.cleanup();
			this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
			return;
		}
		if (matchesKey(data, "escape") || data === "n" || data === "N") {
			this.confirmingDiscard = false;
			return;
		}
		if (this.keys.selectConfirm(data)) {
			this.cleanup();
			if (this.discardSelected === 0) this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
			else this.done(this.buildResult());
			return;
		}
		if (data === "y" || data === "Y") {
			this.cleanup();
			this.done({
				cancelled: true,
				changes: /* @__PURE__ */ new Map()
			});
			return;
		}
		if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "tab")) this.discardSelected = this.discardSelected === 0 ? 1 : 0;
	}
	moveCursor(delta) {
		if (this.visibleItems.length === 0) return;
		this.cursorIndex = Math.max(0, Math.min(this.visibleItems.length - 1, this.cursorIndex + delta));
	}
	rebuildServerTools(server, entry) {
		const existingState = /* @__PURE__ */ new Map();
		for (const t of server.tools) existingState.set(t.name, t.isDirect);
		const newTools = [];
		for (const tool of entry.tools ?? []) {
			if (isToolExcluded(tool.name, server.name, this.prefix, server.excludeTools)) continue;
			const prev = existingState.get(tool.name);
			const isDirect = prev !== void 0 ? prev : false;
			newTools.push({
				name: tool.name,
				description: tool.description ?? "",
				isDirect,
				wasDirect: prev !== void 0 ? server.tools.find((t) => t.name === tool.name)?.wasDirect ?? false : false,
				estimatedTokens: estimateTokens(tool)
			});
		}
		if (server.exposeResources) for (const resource of entry.resources ?? []) {
			const baseName = `get_${resourceNameToToolName(resource.name)}`;
			if (isToolExcluded(baseName, server.name, this.prefix, server.excludeTools)) continue;
			const prev = existingState.get(baseName);
			const isDirect = prev !== void 0 ? prev : false;
			const ct = {
				name: baseName,
				description: resource.description
			};
			newTools.push({
				name: baseName,
				description: resource.description ?? `Read resource: ${resource.uri}`,
				isDirect,
				wasDirect: prev !== void 0 ? server.tools.find((t) => t.name === baseName)?.wasDirect ?? false : false,
				estimatedTokens: estimateTokens(ct)
			});
		}
		server.tools = newTools;
		this.rebuildVisibleItems();
		this.updateDirty();
	}
	render(width) {
		const innerW = width - 2;
		const lines = [];
		const t = this.t;
		const bold = (s) => `\x1b[1m${s}\x1b[22m`;
		const italic = (s) => `\x1b[3m${s}\x1b[23m`;
		const inverse = (s) => `\x1b[7m${s}\x1b[27m`;
		const row = (content) => fg(t.border, "│") + truncateToWidth(" " + sanitizeRowContent(content), innerW, "…", true) + fg(t.border, "│");
		const emptyRow = () => fg(t.border, "│") + " ".repeat(innerW) + fg(t.border, "│");
		const divider = () => fg(t.border, "├" + "─".repeat(innerW) + "┤");
		const titleText = this.authOnly ? " MCP OAuth " : " MCP Servers ";
		const borderLen = innerW - visibleWidth(titleText);
		const leftB = Math.floor(borderLen / 2);
		const rightB = borderLen - leftB;
		lines.push(fg(t.border, "╭" + "─".repeat(leftB)) + fg(t.title, titleText) + fg(t.border, "─".repeat(rightB) + "╮"));
		lines.push(emptyRow());
		const cursor = fg(t.selected, "│");
		const searchIcon = fg(t.border, "◎");
		if (this.descSearchActive) lines.push(row(`${searchIcon}  ${fg(t.needsAuth, "desc:")} ${this.descQuery}${cursor}`));
		else if (this.nameQuery) lines.push(row(`${searchIcon}  ${this.nameQuery}${cursor}`));
		else lines.push(row(`${searchIcon}  ${fg(t.placeholder, italic("search..."))}`));
		lines.push(emptyRow());
		if (this.noticeLines.length > 0) {
			for (const notice of this.noticeLines) lines.push(row(fg(t.hint, italic(sanitizeDisplayText(notice)))));
			lines.push(emptyRow());
		}
		lines.push(divider());
		if (this.servers.length === 0) {
			lines.push(emptyRow());
			lines.push(row(fg(t.hint, italic(this.authOnly ? "No OAuth-capable MCP servers configured." : "No MCP servers configured."))));
			lines.push(emptyRow());
		} else {
			const maxVis = McpPanel.MAX_VISIBLE;
			const total = this.visibleItems.length;
			const startIdx = Math.max(0, Math.min(this.cursorIndex - Math.floor(maxVis / 2), total - maxVis));
			const endIdx = Math.min(startIdx + maxVis, total);
			lines.push(emptyRow());
			for (let i = startIdx; i < endIdx; i++) {
				const item = this.visibleItems[i];
				const isCursor = i === this.cursorIndex;
				const server = this.servers[item.serverIndex];
				if (item.type === "server") lines.push(row(this.renderServerRow(server, isCursor)));
				else if (item.toolIndex !== void 0) lines.push(row(this.renderToolRow(server.tools[item.toolIndex], isCursor, innerW)));
			}
			lines.push(emptyRow());
			if (total > maxVis) {
				const prog = Math.round((this.cursorIndex + 1) / total * 10);
				lines.push(row(`${rainbowProgress(prog, 10)}  ${fg(t.hint, `${this.cursorIndex + 1}/${total}`)}`));
				lines.push(emptyRow());
			}
			if (this.importNotice) {
				lines.push(row(fg(t.needsAuth, italic(sanitizeDisplayText(this.importNotice)))));
				lines.push(emptyRow());
			}
			if (this.authNotice) {
				lines.push(row(fg(t.needsAuth, italic(sanitizeDisplayText(this.authNotice)))));
				lines.push(emptyRow());
			}
		}
		lines.push(divider());
		lines.push(emptyRow());
		if (this.confirmingDiscard) {
			const discardBtn = this.discardSelected === 0 ? inverse(bold(fg(t.cancel, "  Discard  "))) : fg(t.hint, "  Discard  ");
			const keepBtn = this.discardSelected === 1 ? inverse(bold(fg(t.confirm, "  Keep & Close  "))) : fg(t.hint, "  Keep & Close  ");
			lines.push(row(`Discard unsaved changes?  ${discardBtn}   ${keepBtn}`));
		} else if (this.authOnly) lines.push(row(fg(t.description, "select a server to authenticate")));
		else {
			const directCount = this.servers.reduce((sum, s) => sum + s.tools.filter((t) => t.isDirect).length, 0);
			const totalTokens = this.servers.reduce((sum, s) => sum + s.tools.filter((t) => t.isDirect).reduce((ts, t) => ts + t.estimatedTokens, 0), 0);
			const stats = directCount > 0 ? `${directCount} direct  ~${totalTokens.toLocaleString()} tokens` : "no direct tools";
			lines.push(row(fg(t.description, stats + (this.dirty ? fg(t.needsAuth, "  (unsaved)") : ""))));
		}
		lines.push(emptyRow());
		const hints = this.authOnly ? [
			italic("↑↓") + " navigate",
			italic("⏎") + " auth",
			italic("ctrl+a") + " auth",
			italic("esc") + " clear/close",
			italic("ctrl+c") + " quit"
		] : [
			italic("↑↓") + " navigate",
			italic("space") + " toggle",
			italic("⏎") + " expand/auth",
			italic("ctrl+a") + " auth",
			italic("ctrl+r") + " reconnect",
			italic("?") + " desc search",
			italic("ctrl+s") + " save",
			italic("esc") + " clear/close",
			italic("ctrl+c") + " quit"
		];
		const gap = "  ";
		const gapW = 2;
		const maxW = innerW - 2;
		let curLine = "";
		let curW = 0;
		for (const hint of hints) {
			const hw = visibleWidth(hint);
			const needed = curW === 0 ? hw : gapW + hw;
			if (curW > 0 && curW + needed > maxW) {
				lines.push(row(fg(t.hint, curLine)));
				curLine = hint;
				curW = hw;
			} else {
				curLine += (curW > 0 ? gap : "") + hint;
				curW += needed;
			}
		}
		if (curLine) lines.push(row(fg(t.hint, curLine)));
		lines.push(fg(t.border, "╰" + "─".repeat(innerW) + "╯"));
		return lines;
	}
	renderServerRow(server, isCursor) {
		const t = this.t;
		const bold = (s) => `\x1b[1m${s}\x1b[22m`;
		const expandIcon = server.expanded ? "▾" : "▸";
		const prefix = isCursor ? fg(t.selected, expandIcon) : fg(t.border, server.expanded ? expandIcon : "·");
		const serverName = sanitizeDisplayText(server.name);
		const importKind = sanitizeDisplayText(server.importKind ?? "import");
		const nameStr = isCursor ? bold(fg(t.selected, serverName)) : serverName;
		const importLabel = server.source === "import" ? fg(t.description, ` (${importKind})`) : "";
		const statusLabel = this.renderConnectionStatus(server);
		if (!server.hasCachedData && !this.authOnly) return `${prefix}   ${nameStr}${importLabel}  ${fg(t.description, "(not cached)")}${statusLabel}`;
		const directCount = server.tools.filter((t) => t.isDirect).length;
		const totalCount = server.tools.length;
		let toggleIcon = fg(t.description, "○");
		if (directCount === totalCount && totalCount > 0) toggleIcon = fg(t.direct, "●");
		else if (directCount > 0) toggleIcon = fg(t.needsAuth, "◐");
		let toolInfo = "";
		if (totalCount > 0) {
			toolInfo = `${directCount}/${totalCount}`;
			if (directCount > 0) {
				const tokens = server.tools.filter((t) => t.isDirect).reduce((s, t) => s + t.estimatedTokens, 0);
				toolInfo += `  ~${tokens.toLocaleString()}`;
			}
			toolInfo = fg(t.description, toolInfo);
		}
		return `${prefix} ${toggleIcon} ${nameStr}${importLabel}  ${toolInfo}${statusLabel}`;
	}
	renderConnectionStatus(server) {
		const t = this.t;
		if (this.authInFlight === server.name) return `  ${fg(t.needsAuth, "authenticating")}`;
		if (server.connectionStatus === "needs-auth") return `  ${fg(t.needsAuth, "needs auth")}`;
		if (server.connectionStatus === "connecting") return `  ${fg(t.needsAuth, "connecting")}`;
		if (server.connectionStatus === "failed") return `  ${fg(t.cancel, "failed")}`;
		if (this.authOnly && server.connectionStatus === "connected") return `  ${fg(t.direct, "connected")}`;
		if (this.authOnly) return `  ${fg(t.description, "idle")}`;
		return "";
	}
	renderToolRow(tool, isCursor, innerW) {
		const t = this.t;
		const bold = (s) => `\x1b[1m${s}\x1b[22m`;
		const toggleIcon = tool.isDirect ? fg(t.direct, "●") : fg(t.description, "○");
		const cursor = isCursor ? fg(t.selected, "▸") : " ";
		const toolName = sanitizeDisplayText(tool.name);
		const description = sanitizeDisplayText(tool.description);
		const nameStr = isCursor ? bold(fg(t.selected, toolName)) : toolName;
		const prefixLen = 7 + visibleWidth(toolName);
		const maxDescLen = Math.max(0, innerW - prefixLen - 8);
		return `  ${cursor} ${toggleIcon} ${nameStr} ${maxDescLen > 5 && description ? fg(t.description, "— " + truncateToWidth(description, maxDescLen, "…")) : ""}`;
	}
	invalidate() {}
	dispose() {
		this.cleanup();
	}
};
function createMcpPanel(config, cache, provenance, callbacks, tui, done, options) {
	return new McpPanel(config, cache, provenance, callbacks, tui, done, options ?? {});
}
//#endregion
export { createMcpPanel };
