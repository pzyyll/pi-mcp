import { i as seedHostPiTui, r as getHostPiTui } from "./host-peers.js";
import { g as loadMcpConfig, n as getMissingConfiguredDirectToolServers, r as resolveDirectTools, s as loadMetadataCache, t as buildProxyDescription } from "./direct-tools-resolve.js";
import { a as normalizeDirectToolInputSchema, d as truncateAtWord, r as getConfigPathFromArgv } from "./utils.js";
import { Text, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
//#region src/seed-host-pi-tui.ts
seedHostPiTui({
	matchesKey,
	truncateToWidth,
	visibleWidth,
	Text
});
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/memory/metrics.mjs
/** TypeBox instantiation metrics */
const Metrics = {
	assign: 0,
	create: 0,
	clone: 0,
	discard: 0,
	update: 0
};
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/guard/guard.mjs
/** Returns true if this value is an array */
function IsArray(value) {
	return Array.isArray(value);
}
/** Returns true if this value is null */
function IsNull(value) {
	return IsEqual(value, null);
}
/** Returns true if this value is an object */
function IsObject(value) {
	return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsEqual(left, right) {
	return left === right;
}
/** Returns true if the value appears to be an instance of a class. */
function IsClassInstance(value) {
	if (!IsObject(value)) return false;
	const proto = globalThis.Object.getPrototypeOf(value);
	if (IsNull(proto)) return false;
	return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
/** Returns true if the PropertyKey is Unsafe (ref: prototype-pollution). */
function IsUnsafePropertyKey(key) {
	return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
/** Returns true if this value has this property key */
function HasPropertyKey(value, key) {
	return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
/** Returns property keys for this object via `Object.getOwnPropertyNames({ ... })` */
function Keys(value) {
	return Object.getOwnPropertyNames(value);
}
/** Returns the property keys for this object via `Object.getOwnPropertySymbols({ ... })` */
function Symbols(value) {
	return Object.getOwnPropertySymbols(value);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/guard/globals.mjs
function IsTypeArray(value) {
	return globalThis.ArrayBuffer.isView(value);
}
/** Returns true if the value is a RegExp */
function IsRegExp(value) {
	return value instanceof globalThis.RegExp;
}
/** Returns true if the value is a Set */
function IsSet(value) {
	return value instanceof globalThis.Set;
}
/** Returns true if the value is a Map */
function IsMap(value) {
	return value instanceof globalThis.Map;
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
	return value;
}
function IsTypeObject(value) {
	return HasPropertyKey(value, "~kind") || HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
	const result = {};
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Object.keys(descriptors)) {
		if (IsUnsafePropertyKey(key)) continue;
		const descriptor = descriptors[key];
		if (HasPropertyKey(descriptor, "value")) Object.defineProperty(result, key, {
			...descriptor,
			value: FromValue(descriptor.value)
		});
	}
	return result;
}
function FromPlainObject(value) {
	const result = {};
	for (const key of Keys(value)) {
		if (IsUnsafePropertyKey(key)) continue;
		result[key] = FromValue(value[key]);
	}
	for (const key of Symbols(value)) result[key] = FromValue(value[key]);
	return result;
}
function FromObject(value) {
	return IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray(value) {
	return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
	return value.slice();
}
function FromRegExp(value) {
	return new RegExp(value.source, value.flags);
}
function FromMap(value) {
	return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
	return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
	return IsTypeArray(value) ? FromTypedArray(value) : IsRegExp(value) ? FromRegExp(value) : IsMap(value) ? FromMap(value) : IsSet(value) ? FromSet(value) : IsArray(value) ? FromArray(value) : IsObject(value) ? FromObject(value) : value;
}
/**
* Returns a Clone of the given value. This function is similar to structuredClone()
* but also supports deep cloning instances of Map, Set and TypeArray.
*/
function Clone(value) {
	Metrics.clone += 1;
	return FromValue(value);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/settings/settings.mjs
const settings = {
	immutableTypes: false,
	maxErrors: 8,
	useAcceleration: true,
	exactOptionalPropertyTypes: false,
	enumerableKind: false,
	correctiveParse: false,
	unionPrioritySort: true
};
/** Gets current system settings */
function Get() {
	return settings;
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
	for (const key of Object.keys(right)) Object.defineProperty(left, key, {
		configurable: true,
		writable: true,
		enumerable: false,
		value: right[key]
	});
	return left;
}
function Merge(left, right) {
	return {
		...left,
		...right
	};
}
/**
* Creates an object with hidden, enumerable, and optional property sets. This function
* ensures types are instantiated according to configuration rules for enumerable and
* non-enumerable properties.
*/
function Create(hidden, enumerable, options = {}) {
	Metrics.create += 1;
	const settings = Get();
	const withOptions = Merge(enumerable, options);
	const withHidden = settings.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
	return settings.immutableTypes ? Object.freeze(withHidden) : withHidden;
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/memory/update.mjs
/**
* Updates a value with new properties while preserving property enumerability. Use this function to modify
* existing types without altering their configuration.
*/
function Update(current, hidden, enumerable) {
	Metrics.update += 1;
	const settings = Get();
	const result = Clone(current);
	for (const key of Object.keys(hidden)) Object.defineProperty(result, key, {
		configurable: true,
		writable: true,
		enumerable: settings.enumerableKind,
		value: hidden[key]
	});
	for (const key of Object.keys(enumerable)) Object.defineProperty(result, key, {
		configurable: true,
		enumerable: true,
		writable: true,
		value: enumerable[key]
	});
	return result;
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/schema.mjs
function IsSchema(value) {
	return IsObject(value);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
	return Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
	return Update(AddOptionalOperation(type), {}, options);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/action/_add_optional.mjs
/** Applies an AddOptional action to a type. */
function AddOptional(type, options = {}) {
	return AddOptionalAction(type, options);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/_optional.mjs
/** Applies an Optional modifier to the given type. */
function Optional(type) {
	return AddOptional(type);
}
/** Returns true if the given value is TOptional */
function IsOptional(value) {
	return IsSchema(value) && HasPropertyKey(value, "~optional");
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/properties.mjs
/** Creates a RequiredArray derived from the given TProperties value. */
function RequiredArray(properties) {
	return Keys(properties).filter((key) => !IsOptional(properties[key]));
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/object.mjs
/** Creates an Object type. */
function _Object_(properties, options = {}) {
	const requiredKeys = RequiredArray(properties);
	return Create({ "~kind": "Object" }, {
		type: "object",
		...requiredKeys.length > 0 ? { required: requiredKeys } : {},
		properties
	}, options);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/unsafe.mjs
/** Creates a Unsafe type. */
function Unsafe(schema) {
	return Update(schema, { ["~unsafe"]: null }, {});
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/system/hashing/hash.mjs
var ByteMarker;
(function(ByteMarker) {
	ByteMarker[ByteMarker["Array"] = 0] = "Array";
	ByteMarker[ByteMarker["BigInt"] = 1] = "BigInt";
	ByteMarker[ByteMarker["Boolean"] = 2] = "Boolean";
	ByteMarker[ByteMarker["Date"] = 3] = "Date";
	ByteMarker[ByteMarker["Constructor"] = 4] = "Constructor";
	ByteMarker[ByteMarker["Function"] = 5] = "Function";
	ByteMarker[ByteMarker["Null"] = 6] = "Null";
	ByteMarker[ByteMarker["Number"] = 7] = "Number";
	ByteMarker[ByteMarker["Object"] = 8] = "Object";
	ByteMarker[ByteMarker["RegExp"] = 9] = "RegExp";
	ByteMarker[ByteMarker["String"] = 10] = "String";
	ByteMarker[ByteMarker["Symbol"] = 11] = "Symbol";
	ByteMarker[ByteMarker["TypeArray"] = 12] = "TypeArray";
	ByteMarker[ByteMarker["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
Array.from({ length: 256 }).map((_, i) => BigInt(i));
const F64 = /* @__PURE__ */ new Float64Array(1);
new DataView(F64.buffer);
new Uint8Array(F64.buffer);
new TextEncoder();
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/boolean.mjs
/** Creates a Boolean type. */
function Boolean$1(options) {
	return Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/integer.mjs
const IntegerPattern = "-?(?:0|[1-9][0-9]*)";
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/string.mjs
/** Creates a String type. */
function String$1(options) {
	return Create({ "~kind": "String" }, { type: "string" }, options);
}
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/types/record.mjs
const IntegerKey = `^${IntegerPattern}$`;
//#endregion
//#region node_modules/.pnpm/typebox@1.3.6/node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
	return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
const Alpha = [...Range(97, 122), ...Range(65, 90)];
const Digit = ["0", ...Range(49, 57)];
[...Digit];
[...[
	...Alpha,
	"_",
	"$"
], ...Digit];
[...Digit];
new RegExp(IntegerKey);
//#endregion
//#region src/direct-tool-register.ts
function buildDirectToolParameters(inputSchema) {
	return Unsafe(normalizeDirectToolInputSchema(inputSchema));
}
function buildProxyToolParameters() {
	return _Object_({
		tool: Optional(String$1({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
		args: Optional(String$1({ description: "Arguments as JSON string (e.g., '{\"key\": \"value\"}')" })),
		connect: Optional(String$1({ description: "Server name to connect (lazy connect + metadata refresh)" })),
		describe: Optional(String$1({ description: "Tool name to describe (shows parameters)" })),
		search: Optional(String$1({ description: "Search tools by name/description" })),
		regex: Optional(Boolean$1({ description: "Treat search as regex (default: substring match)" })),
		includeSchemas: Optional(Boolean$1({ description: "Include parameter schemas in search results (default: true)" })),
		server: Optional(String$1({ description: "Filter to specific server (also disambiguates tool calls)" })),
		action: Optional(String$1({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" }))
	});
}
//#endregion
//#region src/tool-result-renderer.ts
function Text$1(text, x, y) {
	const { Text: HostText } = getHostPiTui();
	return new HostText(text, x, y);
}
const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
function truncateText(value, maxChars) {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
function formatJsonish(value, maxChars) {
	if (typeof value === "string") try {
		return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
	} catch {
		return truncateText(value, maxChars);
	}
	try {
		return truncateText(JSON.stringify(value, null, 2), maxChars);
	} catch {
		return truncateText(String(value), maxChars);
	}
}
function hasUsefulObjectContent(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
function formatMcpProxyToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
	if (args.action === "ui-messages") return [`mcp ${args.action}`];
	if (args.tool) {
		const lines = [`mcp call ${args.server ? `${args.tool} @ ${args.server}` : args.tool}`];
		if (args.args) lines.push(formatJsonish(args.args, maxInputChars));
		return lines;
	}
	if (args.connect) return [`mcp connect ${args.connect}`];
	if (args.describe) return [`mcp describe ${args.describe}`];
	if (args.search) {
		let line = `mcp search ${args.search}`;
		if (args.server) line += ` @ ${args.server}`;
		if (args.regex === true) line += " (regex)";
		if (args.includeSchemas === false) line += " (schemas hidden)";
		return [line];
	}
	if (args.server) return [`mcp list ${args.server}`];
	if (args.action) return [`mcp ${args.action}`];
	return ["mcp status"];
}
function formatMcpDirectToolCallLines(displayName, args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
	if (!hasUsefulObjectContent(args)) return [displayName];
	return [displayName, formatJsonish(args, maxInputChars)];
}
function renderToolCallLines(lines, theme) {
	const [title = "mcp", ...rest] = lines;
	return Text$1([theme.fg("toolTitle", theme.bold ? theme.bold(title) : title), ...rest.map((line) => theme.fg("muted", line))].join("\n"), 0, 0);
}
function renderMcpProxyToolCall(args, theme) {
	return renderToolCallLines(formatMcpProxyToolCallLines(args), theme);
}
function createMcpDirectToolCallRenderer(displayName) {
	return (args, theme) => {
		return renderToolCallLines(formatMcpDirectToolCallLines(displayName, args), theme);
	};
}
function blockToLines(block) {
	if (block.type === "text") return block.text.split("\n");
	return [`[image: ${block.mimeType}]`];
}
function formatMcpToolResultLines(result, expanded, maxCollapsedLines = 3) {
	const allLines = result.content.flatMap(blockToLines);
	const lines = allLines.length > 0 ? allLines : ["(empty result)"];
	if (expanded || lines.length <= maxCollapsedLines) return {
		lines,
		truncated: false
	};
	return {
		lines: [...lines.slice(0, maxCollapsedLines), "…"],
		truncated: true
	};
}
function renderMcpToolResult(result, options, theme, context) {
	if (options.isPartial) return Text$1(theme.fg("warning", "Running MCP tool..."), 0, 0);
	const hasErrorDetails = Boolean(result.details.error);
	const display = formatMcpToolResultLines(result, options.expanded || context?.isError === true || hasErrorDetails);
	return Text$1(`${display.lines.map((line) => line === "…" ? theme.fg("muted", line) : theme.fg("toolOutput", line)).join("\n")}${display.truncated && !options.expanded ? `\n${theme.fg("muted", "(Ctrl+O to expand)")}` : ""}`, 0, 0);
}
//#endregion
//#region src/error-signal.ts
/**
* Decide the `isError` override for a finished tool result in the `tool_result` hook.
*
* A failed MCP tool call is *returned* (not thrown), tagged `details.error: "tool_error"` (the server
* returned an error result) or `"call_failed"` (the call itself threw and was caught). pi never reads a
* result-level `isError`, so without this such a call is recorded as a success. Returning
* `{ isError: true }` (and nothing else) flips the flag; pi's field-by-field merge keeps the original
* `content` and `details` intact.
*
* Limited to those two codes: the adapter's other `details.error` values (`auth_required`, connection
* states, search/validation feedback, ...) are not failed tool calls, so they get no override.
*/
function toolErrorOverride(details) {
	if (details && typeof details === "object" && "error" in details) {
		const code = details.error;
		if (code === "tool_error" || code === "call_failed") return { isError: true };
	}
}
//#endregion
//#region src/index.ts
function createDirectToolTrampoline(getState, getInitPromise, spec) {
	let executorPromise = null;
	return async (toolCallId, params, signal, onUpdate, ctx) => {
		if (!executorPromise) executorPromise = import("./init.js").then((n) => n.s).then((mod) => mod.createDirectToolExecutor(getState, getInitPromise, spec));
		return (await executorPromise)(toolCallId, params, signal, onUpdate, ctx);
	};
}
function mcpAdapter(pi) {
	let state = null;
	let initPromise = null;
	let lifecycleGeneration = 0;
	async function shutdownState(currentState, reason) {
		if (!currentState) return;
		if (currentState.uiServer) {
			currentState.uiServer.close(reason);
			currentState.uiServer = null;
		}
		let flushError;
		try {
			const { flushMetadataCache } = await import("./init.js").then((n) => n.n);
			flushMetadataCache(currentState);
		} catch (error) {
			flushError = error;
		}
		try {
			await currentState.lifecycle.gracefulShutdown();
		} catch (error) {
			if (flushError) console.error("MCP: graceful shutdown failed after metadata flush error", error);
			else throw error;
		}
		if (flushError) throw flushError;
	}
	const earlyConfigPath = getConfigPathFromArgv();
	const earlyConfig = loadMcpConfig(earlyConfigPath);
	const earlyCache = loadMetadataCache();
	const prefix = earlyConfig.settings?.toolPrefix ?? "server";
	const envRaw = process.env.MCP_DIRECT_TOOLS;
	const directSpecs = envRaw === "__none__" ? [] : resolveDirectTools(earlyConfig, earlyCache, prefix, envRaw?.split(",").map((s) => s.trim()).filter(Boolean));
	const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
	const shouldRegisterProxyTool = earlyConfig.settings?.disableProxyTool !== true || directSpecs.length === 0 || missingConfiguredDirectToolServers.length > 0;
	for (const spec of directSpecs) pi.registerTool({
		name: spec.prefixedName,
		label: `MCP: ${spec.originalName}`,
		description: spec.description || "(no description)",
		promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
		parameters: buildDirectToolParameters(spec.inputSchema),
		execute: createDirectToolTrampoline(() => state, () => initPromise, spec),
		renderCall: createMcpDirectToolCallRenderer(spec.prefixedName),
		renderResult: renderMcpToolResult
	});
	const getPiTools = () => pi.getAllTools();
	pi.registerFlag("mcp-config", {
		description: "Path to MCP config file",
		type: "string"
	});
	pi.on("session_start", async (_event, ctx) => {
		const generation = ++lifecycleGeneration;
		const previousState = state;
		state = null;
		initPromise = null;
		try {
			const { shutdownOAuth } = await import("./mcp-auth-flow.js").then((n) => n.i);
			await Promise.all([shutdownState(previousState, "session_restart"), shutdownOAuth()]);
		} catch (error) {
			console.error("MCP: failed to shut down previous session state", error);
		}
		if (generation !== lifecycleGeneration) return;
		const { initializeOAuth } = await import("./mcp-auth-flow.js").then((n) => n.i);
		await initializeOAuth().catch((err) => {
			console.error("MCP OAuth initialization failed:", err);
		});
		const { initializeMcp, updateStatusBar } = await import("./init.js").then((n) => n.n);
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
		}).catch((err) => {
			if (generation !== lifecycleGeneration) return;
			if (initPromise !== promise && initPromise !== null) return;
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
			const { shutdownOAuth } = await import("./mcp-auth-flow.js").then((n) => n.i);
			await Promise.all([shutdownState(currentState, "session_shutdown"), shutdownOAuth()]);
		} catch (error) {
			console.error("MCP: session shutdown cleanup failed", error);
		}
	});
	pi.on("tool_result", (event) => toolErrorOverride(event.details));
	pi.registerCommand("mcp", {
		description: "Show MCP server status",
		handler: async (args, ctx) => {
			if (!state && initPromise) try {
				state = await initPromise;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
				return;
			}
			if (!state) {
				if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
				return;
			}
			const { showStatus, showTools, reconnectServers, logoutServer, openMcpPanel, openMcpSetup } = await import("./commands.js");
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
				case "setup":
					if ((await openMcpSetup(state, pi, ctx, earlyConfigPath, "setup"))?.configChanged) {
						await ctx.reload();
						return;
					}
					break;
				case "logout": {
					const serverName = rest;
					if (!serverName) {
						if (ctx.hasUI) ctx.ui.notify("Usage: /mcp logout <server>", "error");
						return;
					}
					await logoutServer(serverName, state, ctx);
					break;
				}
				default:
					if (ctx.hasUI) {
						if ((await openMcpPanel(state, pi, ctx, earlyConfigPath))?.configChanged) {
							await ctx.reload();
							return;
						}
					} else await showStatus(state, ctx);
					break;
			}
		}
	});
	pi.registerCommand("mcp-auth", {
		description: "Authenticate with an MCP server (OAuth)",
		handler: async (args, ctx) => {
			const serverName = args?.trim();
			if (!serverName && !ctx.hasUI) return;
			if (!state && initPromise) try {
				state = await initPromise;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
				return;
			}
			if (!state) {
				if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
				return;
			}
			const { authenticateServer, openMcpAuthPanel } = await import("./commands.js");
			if (!serverName) {
				await openMcpAuthPanel(state, pi, ctx, earlyConfigPath);
				return;
			}
			await authenticateServer(serverName, state.config, ctx);
		}
	});
	if (shouldRegisterProxyTool) pi.registerTool({
		name: "mcp",
		label: "MCP",
		description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
		promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
		renderCall: renderMcpProxyToolCall,
		parameters: buildProxyToolParameters(),
		renderResult: renderMcpToolResult,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			let parsedArgs;
			if (params.args) try {
				parsedArgs = JSON.parse(params.args);
				if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) throw new Error(`Invalid args: expected a JSON object, got ${Array.isArray(parsedArgs) ? "array" : parsedArgs === null ? "null" : typeof parsedArgs}`);
			} catch (error) {
				if (error instanceof SyntaxError) throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
				throw error;
			}
			if (!state && initPromise) try {
				state = await initPromise;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{
						type: "text",
						text: `MCP initialization failed: ${message}`
					}],
					details: {
						error: "init_failed",
						message
					}
				};
			}
			if (!state) return {
				content: [{
					type: "text",
					text: "MCP not initialized"
				}],
				details: { error: "not_initialized" }
			};
			const proxyModes = await import("./proxy-modes.js");
			if (params.action === "ui-messages") return proxyModes.executeUiMessages(state);
			if (params.action === "auth-start") {
				if (!params.server) return {
					content: [{
						type: "text",
						text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })"
					}],
					details: {
						mode: "auth-start",
						error: "missing_server"
					}
				};
				return proxyModes.executeAuthStart(state, params.server);
			}
			if (params.action === "auth-complete") {
				if (!params.server) return {
					content: [{
						type: "text",
						text: "auth-complete requires `server`."
					}],
					details: {
						mode: "auth-complete",
						error: "missing_server"
					}
				};
				const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
				if (typeof input !== "string" || input.trim().length === 0) return {
					content: [{
						type: "text",
						text: "auth-complete requires args with `redirectUrl`, `code`, or `input`."
					}],
					details: {
						mode: "auth-complete",
						error: "missing_input"
					}
				};
				return proxyModes.executeAuthComplete(state, params.server, input);
			}
			if (params.tool) return proxyModes.executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
			if (params.connect) return proxyModes.executeConnect(state, params.connect, signal);
			if (params.describe) return proxyModes.executeDescribe(state, params.describe);
			if (params.search) return proxyModes.executeSearch(state, params.search, params.regex, params.server, params.includeSchemas);
			if (params.server) return proxyModes.executeList(state, params.server);
			return proxyModes.executeStatus(state);
		}
	});
}
//#endregion
export { mcpAdapter as default };
