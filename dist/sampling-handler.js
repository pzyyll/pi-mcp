import { t as ensureHostPiAi } from "./host-peers.js";
import { d as truncateAtWord } from "./utils.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
//#region src/sampling-handler.ts
function registerSamplingHandler(client, options) {
	client.setRequestHandler(CreateMessageRequestSchema, (request) => {
		return handleSamplingRequest(options, request);
	});
}
async function handleSamplingRequest(options, request) {
	const params = request.params;
	if ("task" in params && params.task) throw new Error("MCP sampling tasks are not supported");
	if (params.includeContext && params.includeContext !== "none") throw new Error("MCP sampling context inclusion is not supported");
	if (params.tools?.length) throw new Error("MCP sampling tool use is not supported");
	if (params.toolChoice) throw new Error("MCP sampling tool choice is not supported");
	if (params.stopSequences?.length) throw new Error("MCP sampling stop sequences are not supported");
	const messages = params.messages.map(convertSamplingMessage);
	const { model, apiKey, headers } = await resolveSamplingModel(options, params.modelPreferences);
	await confirmSampling(options, "Approve MCP sampling request", formatRequestApproval(options.serverName, `${model.provider}/${model.id}`, params.systemPrompt, messages));
	const { complete } = await ensureHostPiAi();
	const converted = convertAssistantResult(await complete(model, {
		systemPrompt: params.systemPrompt,
		messages
	}, {
		apiKey,
		headers,
		maxTokens: params.maxTokens,
		temperature: params.temperature,
		metadata: params.metadata,
		signal: options.getSignal()
	}));
	await confirmSampling(options, "Return MCP sampling response", formatResponseApproval(options.serverName, converted));
	return converted;
}
function formatRequestApproval(serverName, modelName, systemPrompt, messages) {
	const lines = [`${serverName} wants to sample ${messages.length} message${messages.length === 1 ? "" : "s"} with ${modelName}.`];
	if (systemPrompt) lines.push(`System: ${truncateAtWord(systemPrompt, 400)}`);
	for (const [index, message] of messages.entries()) lines.push(`${index + 1}. ${message.role}: ${truncateAtWord(messageText(message), 400)}`);
	return lines.join("\n\n");
}
function formatResponseApproval(serverName, response) {
	const text = response.content.type === "text" ? response.content.text : `[${response.content.type} content]`;
	return `${serverName} will receive this response from ${response.model}:\n\n${truncateAtWord(text, 1e3)}`;
}
function messageText(message) {
	const { content } = message;
	if (typeof content === "string") return content;
	return content.map((block) => {
		if (block.type === "text") return block.text ?? "";
		if (block.type === "image") return `[image: ${block.mimeType}]`;
		if (block.type === "thinking") return "[thinking]";
		if (block.type === "toolCall") return `[tool call: ${block.name}]`;
		return "[content]";
	}).join("\n");
}
async function resolveSamplingModel(options, modelPreferences) {
	const candidates = [];
	const availableModels = options.modelRegistry.getAvailable();
	for (const hint of modelPreferences?.hints ?? []) {
		const normalizedHint = hint.name?.trim().toLowerCase();
		if (!normalizedHint) continue;
		for (const model of availableModels) if ([
			`${model.provider}/${model.id}`,
			model.id,
			model.name
		].some((name) => name.toLowerCase().includes(normalizedHint))) addSamplingCandidate(candidates, model);
	}
	const currentModel = options.getCurrentModel();
	if (currentModel) addSamplingCandidate(candidates, currentModel);
	for (const model of availableModels) addSamplingCandidate(candidates, model);
	const errors = [];
	for (const model of candidates) {
		const auth = await options.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok === false) {
			errors.push(`${model.provider}/${model.id}: ${auth.error}`);
			continue;
		}
		return {
			model,
			apiKey: auth.apiKey,
			headers: auth.headers
		};
	}
	if (errors.length > 0) throw new Error(`No configured auth for MCP sampling model. ${errors.join("; ")}`);
	throw new Error("No Pi model is available for MCP sampling");
}
function addSamplingCandidate(candidates, model) {
	if (!candidates.some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) candidates.push(model);
}
async function confirmSampling(options, title, message) {
	if (options.autoApprove) return;
	if (!options.ui) throw new Error("MCP sampling requires interactive approval. Set settings.samplingAutoApprove to true to allow it without UI.");
	if (!await options.ui.confirm(title, message)) throw new Error("MCP sampling request was declined");
}
function convertSamplingMessage(message) {
	const blocks = Array.isArray(message.content) ? message.content : [message.content];
	if (message.role === "user") return {
		role: "user",
		content: blocks.map(convertUserContent),
		timestamp: Date.now()
	};
	return {
		role: "assistant",
		content: blocks.map(convertAssistantContent),
		api: "mcp-sampling",
		provider: "mcp",
		model: "sampling-request",
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now()
	};
}
function convertUserContent(block) {
	if (block.type === "text") return {
		type: "text",
		text: block.text
	};
	throw new Error(`MCP sampling ${block.type} content is not supported`);
}
function convertAssistantContent(block) {
	if (block.type === "text") return {
		type: "text",
		text: block.text
	};
	throw new Error(`MCP sampling assistant ${block.type} content is not supported`);
}
function convertAssistantResult(message) {
	if (message.stopReason === "error") throw new Error(message.errorMessage ?? "MCP sampling model call failed");
	if (message.stopReason === "aborted") throw new Error(message.errorMessage ?? "MCP sampling model call was aborted");
	const text = message.content.map((block) => {
		if (block.type === "text") return block.text;
		if (block.type === "thinking") return void 0;
		throw new Error(`MCP sampling result ${block.type} content is not supported`);
	}).filter((value) => value !== void 0).join("\n\n").trim();
	if (!text) throw new Error("MCP sampling result did not contain text content");
	return {
		role: "assistant",
		content: {
			type: "text",
			text
		},
		model: `${message.provider}/${message.model}`,
		stopReason: mapStopReason(message.stopReason)
	};
}
function mapStopReason(reason) {
	if (reason === "stop") return "endTurn";
	if (reason === "length") return "maxTokens";
	if (reason === "toolUse") return "toolUse";
	return reason;
}
function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
//#endregion
export { registerSamplingHandler };
