//#region src/logger.ts
const LEVEL_PRIORITY = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};
const LEVEL_PREFIX = {
	debug: "[MCP-UI:DEBUG]",
	info: "[MCP-UI]",
	warn: "[MCP-UI:WARN]",
	error: "[MCP-UI:ERROR]"
};
var Logger = class {
	minLevel = "info";
	handlers = [];
	defaultContext = {};
	setLevel(level) {
		this.minLevel = level;
	}
	setDefaultContext(context) {
		this.defaultContext = context;
	}
	addHandler(handler) {
		this.handlers.push(handler);
	}
	clearHandlers() {
		this.handlers = [];
	}
	shouldLog(level) {
		return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
	}
	emit(level, message, context, error) {
		if (!this.shouldLog(level)) return;
		const entry = {
			level,
			message,
			context: {
				...this.defaultContext,
				...context
			},
			error,
			timestamp: /* @__PURE__ */ new Date()
		};
		const prefix = LEVEL_PREFIX[level];
		const contextStr = formatContext(entry.context);
		const fullMessage = contextStr ? `${prefix} ${message} ${contextStr}` : `${prefix} ${message}`;
		if (level === "error") console.error(fullMessage, error ?? "");
		else if (level === "warn") console.warn(fullMessage);
		else if (level === "debug") console.debug(fullMessage);
		else console.log(fullMessage);
		for (const handler of this.handlers) try {
			handler(entry);
		} catch {}
	}
	debug(message, context) {
		this.emit("debug", message, context);
	}
	info(message, context) {
		this.emit("info", message, context);
	}
	warn(message, context) {
		this.emit("warn", message, context);
	}
	error(message, error, context) {
		this.emit("error", message, context, error);
	}
	/**
	* Create a child logger with additional default context.
	*/
	child(context) {
		return new ChildLogger(this, context);
	}
};
var ChildLogger = class ChildLogger {
	parent;
	context;
	constructor(parent, context) {
		this.parent = parent;
		this.context = context;
	}
	debug(message, context) {
		this.parent.debug(message, {
			...this.context,
			...context
		});
	}
	info(message, context) {
		this.parent.info(message, {
			...this.context,
			...context
		});
	}
	warn(message, context) {
		this.parent.warn(message, {
			...this.context,
			...context
		});
	}
	error(message, error, context) {
		this.parent.error(message, error, {
			...this.context,
			...context
		});
	}
	child(context) {
		return new ChildLogger(this.parent, {
			...this.context,
			...context
		});
	}
};
function formatContext(context) {
	if (!context || Object.keys(context).length === 0) return "";
	const parts = [];
	for (const [key, value] of Object.entries(context)) if (value !== void 0 && value !== null) parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
	return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
const logger = new Logger();
if (process.env.MCP_UI_DEBUG === "1" || process.env.MCP_UI_DEBUG === "true") logger.setLevel("debug");
//#endregion
export { logger };
