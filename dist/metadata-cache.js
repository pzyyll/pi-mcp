import { getAgentPath } from "./agent-dir.js";
import { formatToolName, isToolExcluded } from "./types.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { extractToolUiStreamMode, interpolateEnvRecord, resolveBearerToken, resolveConfigPath } from "./utils.js";
import { getToolUiResourceUri } from "./tool-ui-uri.js";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
//#region src/metadata-cache.ts
const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 10080 * 60 * 1e3;
function getMetadataCachePath() {
	return getAgentPath("mcp-cache.json");
}
function loadMetadataCache() {
	const cachePath = getMetadataCachePath();
	if (!existsSync(cachePath)) return null;
	try {
		const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
		if (!raw || typeof raw !== "object") return null;
		if (raw.version !== CACHE_VERSION) return null;
		if (!raw.servers || typeof raw.servers !== "object") return null;
		return raw;
	} catch {
		return null;
	}
}
function saveMetadataCache(cache) {
	const cachePath = getMetadataCachePath();
	mkdirSync(dirname(cachePath), { recursive: true });
	let merged = {
		version: CACHE_VERSION,
		servers: {}
	};
	try {
		if (existsSync(cachePath)) {
			const existing = JSON.parse(readFileSync(cachePath, "utf-8"));
			if (existing && existing.version === CACHE_VERSION && existing.servers) merged.servers = { ...existing.servers };
		}
	} catch {}
	merged.version = CACHE_VERSION;
	merged.servers = {
		...merged.servers,
		...cache.servers
	};
	const tmpPath = `${cachePath}.${process.pid}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
	renameSync(tmpPath, cachePath);
}
function computeServerHash(definition) {
	const normalized = stableStringify({
		command: definition.command,
		args: definition.args,
		env: interpolateEnvRecord(definition.env),
		cwd: resolveConfigPath(definition.cwd),
		url: definition.url,
		headers: interpolateEnvRecord(definition.headers),
		auth: definition.auth,
		bearerToken: resolveBearerToken(definition),
		bearerTokenEnv: definition.bearerTokenEnv,
		exposeResources: definition.exposeResources,
		excludeTools: definition.excludeTools
	});
	return createHash("sha256").update(normalized).digest("hex");
}
function isServerCacheValid(entry, definition, maxAgeMs = CACHE_MAX_AGE_MS) {
	if (!entry || entry.configHash !== computeServerHash(definition)) return false;
	if (!entry.cachedAt || typeof entry.cachedAt !== "number") return false;
	if (maxAgeMs > 0 && Date.now() - entry.cachedAt > maxAgeMs) return false;
	return true;
}
function reconstructToolMetadata(serverName, entry, prefix, definition) {
	const metadata = [];
	for (const tool of entry.tools ?? []) {
		if (!tool?.name) continue;
		if (isToolExcluded(tool.name, serverName, prefix, definition.excludeTools)) continue;
		metadata.push({
			name: formatToolName(tool.name, serverName, prefix),
			originalName: tool.name,
			description: tool.description ?? "",
			inputSchema: tool.inputSchema,
			uiResourceUri: tool.uiResourceUri,
			uiStreamMode: tool.uiStreamMode
		});
	}
	if (definition.exposeResources !== false) for (const resource of entry.resources ?? []) {
		if (!resource?.name || !resource?.uri) continue;
		const baseName = `get_${resourceNameToToolName(resource.name)}`;
		if (isToolExcluded(baseName, serverName, prefix, definition.excludeTools)) continue;
		metadata.push({
			name: formatToolName(baseName, serverName, prefix),
			originalName: baseName,
			description: resource.description ?? `Read resource: ${resource.uri}`,
			resourceUri: resource.uri
		});
	}
	return metadata;
}
function serializeTools(tools) {
	return tools.filter((t) => t?.name).map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
		uiResourceUri: tryGetToolUiResourceUri(t),
		uiStreamMode: extractToolUiStreamMode(t._meta)
	}));
}
function serializeResources(resources) {
	return resources.filter((r) => r?.name && r?.uri).map((r) => ({
		uri: r.uri,
		name: r.name,
		description: r.description
	}));
}
function stableStringify(value) {
	if (value === null || value === void 0 || typeof value !== "object") {
		const serialized = JSON.stringify(value);
		return serialized === void 0 ? "undefined" : serialized;
	}
	if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
	const obj = value;
	return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
function tryGetToolUiResourceUri(tool) {
	try {
		return getToolUiResourceUri({ _meta: tool._meta });
	} catch {
		return;
	}
}
//#endregion
export { computeServerHash, getMetadataCachePath, isServerCacheValid, loadMetadataCache, reconstructToolMetadata, saveMetadataCache, serializeResources, serializeTools };
