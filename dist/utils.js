import { homedir, platform } from "node:os";
import { join } from "node:path";
//#region src/utils.ts
async function execOpen(pi, target, browser) {
	const os = platform();
	if (os === "darwin") return browser ? pi.exec("open", [
		"-a",
		browser,
		target
	]) : pi.exec("open", [target]);
	if (os === "win32") return browser ? pi.exec("cmd", [
		"/c",
		"start",
		"",
		browser,
		target
	]) : pi.exec("cmd", [
		"/c",
		"start",
		"",
		target
	]);
	return browser ? pi.exec(browser, [target]) : pi.exec("xdg-open", [target]);
}
async function openUrl(pi, url, browser) {
	const result = await execOpen(pi, url, browser);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
}
async function openPath(pi, targetPath) {
	const result = await execOpen(pi, targetPath);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open path (exit code ${result.code})`);
}
async function parallelLimit(items, limit, fn) {
	const results = [];
	let index = 0;
	async function worker() {
		while (index < items.length) {
			const i = index++;
			results[i] = await fn(items[i]);
		}
	}
	const workers = Array(Math.min(limit, items.length)).fill(null).map(() => worker());
	await Promise.all(workers);
	return results;
}
function getConfigPathFromArgv() {
	const idx = process.argv.indexOf("--mcp-config");
	if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
}
function interpolateEnvVars(value) {
	return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "").replace(/\$env:(\w+)/g, (_, name) => process.env[name] ?? "");
}
function interpolateEnvRecord(values) {
	if (!values) return void 0;
	const resolved = {};
	for (const [key, value] of Object.entries(values)) resolved[key] = interpolateEnvVars(value);
	return resolved;
}
function resolveConfigPath(value) {
	if (value === void 0) return void 0;
	const resolved = interpolateEnvVars(value);
	if (resolved === "~") return homedir();
	if (resolved.startsWith("~/") || resolved.startsWith("~\\")) return join(homedir(), resolved.slice(2));
	return resolved;
}
function resolveBearerToken(definition) {
	if (definition.bearerToken !== void 0) return interpolateEnvVars(definition.bearerToken);
	return definition.bearerTokenEnv ? process.env[definition.bearerTokenEnv] : void 0;
}
function truncateAtWord(text, target) {
	if (!text || text.length <= target) return text;
	const truncated = text.slice(0, target);
	const lastSpace = truncated.lastIndexOf(" ");
	if (lastSpace > target * .6) return truncated.slice(0, lastSpace) + "...";
	return truncated + "...";
}
function normalizeDirectToolInputSchema(schema) {
	const { $schema: _$schema, additionalProperties: _additionalProperties, ...normalized } = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {
		type: "object",
		properties: {}
	};
	return normalized;
}
function formatAuthRequiredMessage(config, serverName, defaultMessage) {
	const template = config.settings?.authRequiredMessage;
	return template ? template.replaceAll("${server}", serverName) : defaultMessage;
}
/**
* Extract the adapter-owned UI stream mode from tool metadata.
*/
function extractToolUiStreamMode(toolMeta) {
	const uiMeta = toolMeta?.ui;
	if (!uiMeta || typeof uiMeta !== "object") return void 0;
	const streamMode = uiMeta["pi-mcp-adapter.streamMode"];
	if (streamMode === "eager" || streamMode === "stream-first") return streamMode;
}
//#endregion
export { extractToolUiStreamMode, formatAuthRequiredMessage, getConfigPathFromArgv, interpolateEnvRecord, interpolateEnvVars, normalizeDirectToolInputSchema, openPath, openUrl, parallelLimit, resolveBearerToken, resolveConfigPath, truncateAtWord };
