//#region src/errors.ts
/**
* Base error class for MCP UI errors.
*/
var McpUiError = class extends Error {
	code;
	context;
	recoveryHint;
	cause;
	constructor(message, options) {
		super(message);
		this.name = "McpUiError";
		this.code = options.code;
		this.context = options.context ?? {};
		this.recoveryHint = options.recoveryHint;
		this.cause = options.cause;
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
	}
	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			context: this.context,
			recoveryHint: this.recoveryHint,
			stack: this.stack
		};
	}
};
/**
* Error fetching a UI resource from the MCP server.
*/
var ResourceFetchError = class extends McpUiError {
	constructor(uri, reason, options) {
		super(`Failed to fetch UI resource "${uri}": ${reason}`, {
			code: "RESOURCE_FETCH_ERROR",
			context: {
				uri,
				server: options?.server
			},
			recoveryHint: "Check that the MCP server is connected and the resource URI is valid.",
			cause: options?.cause
		});
		this.name = "ResourceFetchError";
	}
};
/**
* Error parsing or validating UI resource content.
*/
var ResourceParseError = class extends McpUiError {
	constructor(uri, reason, options) {
		super(`Invalid UI resource "${uri}": ${reason}`, {
			code: "RESOURCE_PARSE_ERROR",
			context: {
				uri,
				server: options?.server,
				mimeType: options?.mimeType
			},
			recoveryHint: "Ensure the resource returns valid HTML with the correct MIME type."
		});
		this.name = "ResourceParseError";
	}
};
/**
* Error connecting to the AppBridge.
*/
var BridgeConnectionError = class extends McpUiError {
	constructor(reason, options) {
		super(`AppBridge connection failed: ${reason}`, {
			code: "BRIDGE_CONNECTION_ERROR",
			context: { session: options?.session },
			recoveryHint: "Check browser console for detailed errors. The iframe may have failed to load.",
			cause: options?.cause
		});
		this.name = "BridgeConnectionError";
	}
};
/**
* Error related to user consent for tool calls.
*/
var ConsentError = class extends McpUiError {
	denied;
	constructor(server, options) {
		const message = options.denied ? `Tool calls for "${server}" were denied for this session` : `Tool call approval required for "${server}"`;
		super(message, {
			code: options.denied ? "CONSENT_DENIED" : "CONSENT_REQUIRED",
			context: { server },
			recoveryHint: options.denied ? "The user denied tool access. Start a new session to try again." : "Prompt the user for consent before calling tools."
		});
		this.name = "ConsentError";
		this.denied = options.denied ?? false;
	}
};
/**
* Error with UI server session management.
*/
var SessionError = class extends McpUiError {
	constructor(reason, options) {
		super(`Session error: ${reason}`, {
			code: "SESSION_ERROR",
			context: { session: options?.session },
			recoveryHint: "The session may have expired or been closed. Try opening the UI again.",
			cause: options?.cause
		});
		this.name = "SessionError";
	}
};
/**
* Error starting or operating the UI server.
*/
var ServerError = class extends McpUiError {
	constructor(reason, options) {
		super(`UI server error: ${reason}`, {
			code: "SERVER_ERROR",
			context: { port: options?.port },
			recoveryHint: "Check if the port is available. Another process may be using it.",
			cause: options?.cause
		});
		this.name = "ServerError";
	}
};
/**
* Error communicating with the MCP server.
*/
var McpServerError = class extends McpUiError {
	constructor(server, reason, options) {
		super(`MCP server "${server}" error: ${reason}`, {
			code: "MCP_SERVER_ERROR",
			context: {
				server,
				tool: options?.tool
			},
			recoveryHint: "Check that the MCP server is running and responsive.",
			cause: options?.cause
		});
		this.name = "McpServerError";
	}
};
/**
* Wrap an unknown error into an McpUiError.
*/
function wrapError(error, context) {
	if (error instanceof McpUiError) return new McpUiError(error.message, {
		code: error.code,
		context: {
			...error.context,
			...context
		},
		recoveryHint: error.recoveryHint,
		cause: error.cause
	});
	const cause = error instanceof Error ? error : void 0;
	return new McpUiError(error instanceof Error ? error.message : String(error), {
		code: "UNKNOWN_ERROR",
		context,
		cause
	});
}
/**
* Check if an error is a specific MCP UI error type.
*/
function isErrorCode(error, code) {
	return error instanceof McpUiError && error.code === code;
}
//#endregion
export { BridgeConnectionError, ConsentError, McpServerError, McpUiError, ResourceFetchError, ResourceParseError, ServerError, SessionError, isErrorCode, wrapError };
