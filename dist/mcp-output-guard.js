import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
//#region src/mcp-output-guard.ts
const DEFAULT_MCP_OUTPUT_MAX_BYTES = 50 * 1024;
const DEFAULT_MCP_OUTPUT_MAX_LINES = 2e3;
const DEFAULT_MCP_DETAILS_MAX_BYTES = 16 * 1024;
const CONTENT_SUMMARY_LIMIT = 20;
const KEY_PREVIEW_LIMIT = 20;
const KEY_MAX_CHARS = 120;
function resolveMcpOutputGuardOptions(settings) {
	const configured = settings?.outputGuard;
	const tuning = typeof configured === "object" && configured !== null ? configured : void 0;
	return {
		enabled: envKillSwitch("MCP_OUTPUT_GUARD") ?? configured !== false,
		maxBytes: positiveInt(tuning?.maxBytes) ?? 51200,
		maxLines: positiveInt(tuning?.maxLines) ?? 2e3,
		detailsMaxBytes: positiveInt(tuning?.detailsMaxBytes) ?? 16384
	};
}
/** Spread helper for tool-result details: includes mcpResult/outputGuard only when present. */
function guardedMcpDetails(guarded) {
	return {
		...guarded.mcpResult !== void 0 ? { mcpResult: guarded.mcpResult } : {},
		...guarded.outputGuard ? { outputGuard: guarded.outputGuard } : {}
	};
}
/**
* Bound model-facing MCP output. Text output is capped at maxBytes/maxLines and
* spilled to a temp file when oversized. Image blocks pass through untouched —
* they are delivered to the provider as native image content, not text context.
*/
async function guardMcpOutput(content, options = {}) {
	const maxBytes = options.maxBytes ?? 51200;
	const maxLines = options.maxLines ?? 2e3;
	const detailsMaxBytes = options.detailsMaxBytes ?? 16384;
	const prefix = options.prefix ?? "";
	const suffix = options.suffix ?? "";
	const normalizedContent = withEmptyTextFallback(content.length > 0 ? sanitizeContent(content) : [{
		type: "text",
		text: options.emptyTextFallback ?? "(empty result)"
	}], options.emptyTextFallback);
	if (options.enabled === false) return {
		content: addAffixes(normalizedContent, prefix, suffix),
		mcpResult: options.rawMcpResult
	};
	const imageBlocks = normalizedContent.filter((block) => block.type === "image");
	const composedOutput = `${prefix}${normalizedContent.filter((block) => block.type === "text").map((block) => block.text).join("\n")}${suffix}`;
	const stats = textStats(composedOutput);
	let guardedContent = addAffixes(normalizedContent, prefix, suffix);
	let outputGuard;
	if (stats.bytes > maxBytes || stats.lines > maxLines) {
		const { path: fullOutputPath, error: writeError } = await saveArtifact("output", composedOutput);
		const notice = formatTruncationNotice(stats, fullOutputPath, writeError);
		const previewBudget = reserveBudget(maxBytes, maxLines, notice);
		const finalText = `${truncateHead(composedOutput, previewBudget.maxBytes, previewBudget.maxLines).content}\n\n${notice}`;
		const finalStats = textStats(finalText);
		guardedContent = [{
			type: "text",
			text: finalText
		}, ...imageBlocks];
		outputGuard = {
			truncated: true,
			originalBytes: stats.bytes,
			returnedBytes: finalStats.bytes,
			originalLines: stats.lines,
			returnedLines: finalStats.lines,
			...imageBlocks.length > 0 ? { imageBlocksPassedThrough: imageBlocks.length } : {},
			fullOutputPath,
			writeError
		};
	}
	const mcpResult = options.rawMcpResult === void 0 ? void 0 : await boundMcpResult(options.rawMcpResult, detailsMaxBytes);
	return {
		content: guardedContent,
		outputGuard,
		mcpResult
	};
}
function sanitizeContent(content) {
	return content.map((block) => {
		if (block.type !== "image") return block;
		const mimeType = typeof block.mimeType === "string" && block.mimeType.trim() ? block.mimeType.trim().slice(0, 100) : "image/png";
		return {
			...block,
			mimeType
		};
	});
}
function withEmptyTextFallback(content, fallback) {
	if (!fallback) return content;
	if (content.filter((block) => block.type === "text").map((block) => block.text).join("\n")) return content;
	return [{
		type: "text",
		text: fallback
	}, ...content.filter((block) => block.type === "image")];
}
function addAffixes(content, prefix, suffix) {
	if (!prefix && !suffix) return content;
	const next = [...content];
	if (prefix) {
		const index = next.findIndex((block) => block.type === "text");
		const block = next[index];
		if (index >= 0 && block.type === "text") next[index] = {
			...block,
			text: `${prefix}${block.text}`
		};
		else next.unshift({
			type: "text",
			text: prefix
		});
	}
	if (suffix) {
		let index = -1;
		for (let i = next.length - 1; i >= 0; i--) if (next[i].type === "text") {
			index = i;
			break;
		}
		const block = next[index];
		if (index >= 0 && block.type === "text") next[index] = {
			...block,
			text: `${block.text}${suffix}`
		};
		else next.push({
			type: "text",
			text: suffix
		});
	}
	return next;
}
function reserveBudget(maxBytes, maxLines, notice) {
	const noticeStats = textStats(`\n\n${notice}`);
	return {
		maxBytes: Math.max(0, maxBytes - noticeStats.bytes),
		maxLines: Math.max(0, maxLines - noticeStats.lines)
	};
}
function truncateHead(text, maxBytes, maxLines) {
	const lines = text.split("\n");
	const output = [];
	let bytes = 0;
	for (const line of lines) {
		if (output.length >= maxLines) break;
		const separatorBytes = output.length > 0 ? 1 : 0;
		const lineBytes = byteLength(line);
		if (bytes + separatorBytes + lineBytes > maxBytes) {
			const remaining = maxBytes - bytes - separatorBytes;
			if (remaining > 0) output.push(truncateStringToBytes(line, remaining));
			break;
		}
		output.push(line);
		bytes += separatorBytes + lineBytes;
	}
	const content = output.join("\n");
	const stats = textStats(content);
	return {
		content,
		bytes: stats.bytes,
		lines: stats.lines
	};
}
function truncateStringToBytes(value, maxBytes) {
	if (byteLength(value) <= maxBytes) return value;
	const buffer = Buffer.from(value, "utf8");
	let end = Math.max(0, maxBytes);
	while (end > 0 && (buffer[end] & 192) === 128) end--;
	return buffer.subarray(0, end).toString("utf8");
}
function formatTruncationNotice(stats, fullOutputPath, writeError) {
	const base = `[MCP text output truncated: original ${stats.lines.toLocaleString()} lines / ${formatSize(stats.bytes)}.`;
	if (fullOutputPath) return `${base} Full text saved to: ${fullOutputPath} — use read with offset/limit or grep to inspect.]`;
	return `${base} Full output could not be saved: ${writeError ?? "unknown error"}]`;
}
/**
* Bound details.mcpResult: keep the raw result when its JSON fits within
* detailsMaxBytes; otherwise replace it with a compact summary and spill the
* raw JSON to a temp file.
*/
async function boundMcpResult(result, detailsMaxBytes) {
	const raw = safeStringify(result);
	const rawBytes = byteLength(raw);
	if (rawBytes <= detailsMaxBytes) return result;
	return summarizeMcpResult(result, raw, rawBytes);
}
async function summarizeMcpResult(result, raw, rawBytes) {
	const { path: fullResultPath, error: resultWriteError } = await saveArtifact("mcp-result", raw);
	const record = asRecord(result);
	const content = Array.isArray(record?.content) ? record.content : [];
	const summary = {
		omitted: true,
		reason: "Raw MCP result exceeded the details size limit and was replaced with this summary to keep session context bounded.",
		isError: record?.isError === true,
		contentBlocks: content.length,
		contentSummary: summarizeContent(content),
		rawResultBytes: rawBytes,
		fullResultPath,
		resultWriteError
	};
	if (record && "structuredContent" in record) summary.structuredContent = summarizeValue(record.structuredContent);
	if (record && "_meta" in record) summary.meta = summarizeValue(record._meta);
	if (record) {
		const standard = /* @__PURE__ */ new Set([
			"content",
			"isError",
			"structuredContent",
			"_meta"
		]);
		const extraFields = Object.keys(record).filter((key) => !standard.has(key)).slice(0, KEY_PREVIEW_LIMIT).map((key) => ({
			key: truncateKey(key),
			type: typeof record[key],
			estimatedBytes: estimateValueBytes(record[key]),
			omitted: true
		}));
		if (extraFields.length > 0) summary.extraFields = extraFields;
	}
	return summary;
}
function summarizeContent(content) {
	const summaries = content.slice(0, CONTENT_SUMMARY_LIMIT).map((block) => {
		const record = asRecord(block);
		if (!record) return {
			type: typeof block,
			omitted: true
		};
		if (record.type === "text") {
			const text = typeof record.text === "string" ? record.text : "";
			return {
				type: "text",
				bytes: byteLength(text),
				lines: textStats(text).lines,
				textOmitted: true
			};
		}
		if (record.type === "image") {
			const data = typeof record.data === "string" ? record.data : "";
			return {
				type: "image",
				mimeType: typeof record.mimeType === "string" ? record.mimeType : void 0,
				dataBytes: byteLength(data),
				dataOmitted: true
			};
		}
		return {
			type: typeof record.type === "string" ? record.type : "unknown",
			estimatedBytes: estimateValueBytes(record),
			omitted: true
		};
	});
	if (content.length > CONTENT_SUMMARY_LIMIT) summaries.push({
		type: "omitted",
		count: content.length - CONTENT_SUMMARY_LIMIT
	});
	return summaries;
}
function summarizeValue(value) {
	const record = asRecord(value);
	if (!record) return {
		type: value === null ? "null" : typeof value,
		estimatedBytes: estimateValueBytes(value),
		omitted: true
	};
	const keys = Object.keys(record);
	return {
		type: Array.isArray(value) ? "array" : "object",
		estimatedBytes: estimateValueBytes(value),
		keyCount: keys.length,
		keysPreview: keys.slice(0, KEY_PREVIEW_LIMIT).map(truncateKey),
		omitted: true
	};
}
function estimateValueBytes(value, depth = 0) {
	if (value === null || value === void 0) return 0;
	if (typeof value === "string") return byteLength(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return byteLength(String(value));
	const record = asRecord(value);
	if (!record || depth >= 2) return 0;
	return (Array.isArray(value) ? value.slice(0, KEY_PREVIEW_LIMIT) : Object.values(record).slice(0, KEY_PREVIEW_LIMIT)).reduce((total, item) => total + estimateValueBytes(item, depth + 1), 0);
}
function truncateKey(key) {
	return key.length <= KEY_MAX_CHARS ? key : `${key.slice(0, KEY_MAX_CHARS - 1)}…`;
}
async function saveArtifact(kind, text) {
	try {
		const path = join(await mkdtemp(join(tmpdir(), "pi-mcp-output-")), `${kind}-${randomBytes(4).toString("hex")}.txt`);
		await writeFile(path, text, {
			encoding: "utf8",
			mode: 384
		});
		return { path };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}
function asRecord(value) {
	return typeof value === "object" && value !== null ? value : void 0;
}
function safeStringify(value) {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
function textStats(text) {
	return {
		bytes: byteLength(text),
		lines: text.length === 0 ? 0 : text.split("\n").length
	};
}
function byteLength(text) {
	return Buffer.byteLength(text, "utf8");
}
function positiveInt(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
	const integer = Math.floor(value);
	return integer > 0 ? integer : void 0;
}
function envKillSwitch(name) {
	const value = process.env[name]?.trim().toLowerCase();
	if (!value) return void 0;
	if ([
		"0",
		"false",
		"no",
		"off"
	].includes(value)) return false;
	if ([
		"1",
		"true",
		"yes",
		"on"
	].includes(value)) return true;
}
function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
//#endregion
export { DEFAULT_MCP_DETAILS_MAX_BYTES, DEFAULT_MCP_OUTPUT_MAX_BYTES, DEFAULT_MCP_OUTPUT_MAX_LINES, guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions };
