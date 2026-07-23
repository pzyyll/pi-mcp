import { getAgentPath } from "./agent-dir.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
//#region src/config.ts
const GENERIC_GLOBAL_CONFIG_PATH = join(homedir(), ".config", "mcp", "mcp.json");
const PROJECT_CONFIG_NAME = ".mcp.json";
const PROJECT_PI_CONFIG_NAME = ".pi/mcp.json";
const REPOPROMPT_BINARY_CANDIDATES = [join(homedir(), "RepoPrompt", "repoprompt_cli"), "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp"];
const IMPORT_PATHS = {
	cursor: [join(homedir(), ".cursor", "mcp.json")],
	"claude-code": [
		join(homedir(), ".claude", "mcp.json"),
		join(homedir(), ".claude.json"),
		join(homedir(), ".claude", "claude_desktop_config.json")
	],
	"claude-desktop": [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
	codex: [join(homedir(), ".codex", "config.json")],
	windsurf: [join(homedir(), ".windsurf", "mcp.json")],
	vscode: [".vscode/mcp.json"]
};
function getPiGlobalConfigPath(overridePath) {
	return overridePath ? resolve(overridePath) : getAgentPath("mcp.json");
}
function getGenericGlobalConfigPath() {
	return GENERIC_GLOBAL_CONFIG_PATH;
}
function getProjectConfigPath(cwd = process.cwd()) {
	return resolve(cwd, PROJECT_CONFIG_NAME);
}
function getProjectPiConfigPath(cwd = process.cwd()) {
	return resolve(cwd, PROJECT_PI_CONFIG_NAME);
}
function getConfigDiscoveryPaths(overridePath, cwd = process.cwd()) {
	return getConfigSources(overridePath, cwd).map((source) => ({
		label: source.label,
		path: source.readPath,
		exists: existsSync(source.readPath)
	}));
}
function findAvailableImportConfigs(cwd = process.cwd()) {
	const discovered = [];
	for (const importKind of Object.keys(IMPORT_PATHS)) {
		const importPath = resolveImportPath(importKind, cwd);
		if (importPath) discovered.push({
			kind: importKind,
			path: importPath
		});
	}
	return discovered;
}
function getMcpDiscoverySummary(overridePath, cwd = process.cwd()) {
	const sources = getConfigSources(overridePath, cwd).map((source) => {
		const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
		return {
			id: source.id,
			label: source.label,
			path: source.readPath,
			exists: existsSync(source.readPath),
			scope: source.scope,
			kind: source.shared ? "shared" : "pi",
			serverCount: loaded ? Object.keys(loaded.mcpServers).length : 0
		};
	});
	const imports = Object.keys(IMPORT_PATHS).map((kind) => {
		const path = resolveImportPath(kind, cwd);
		if (!path) return null;
		return {
			kind,
			path,
			serverCount: getImportServerCount(kind, path)
		};
	}).filter((value) => value !== null);
	const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0);
	const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0);
	const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
	const hasAnyDetectedPaths = sources.some((source) => source.exists) || imports.length > 0;
	const summaryWithoutRepoPrompt = {
		sources,
		imports,
		hasAnyConfig: totalServerCount > 0 || imports.some((entry) => entry.serverCount > 0) || hasAnyDetectedPaths,
		hasAnyDetectedPaths,
		hasSharedServers,
		hasPiOwnedServers,
		totalServerCount
	};
	const fingerprint = JSON.stringify({
		sources: sources.map((source) => [
			source.id,
			source.exists,
			source.serverCount
		]),
		imports: imports.map((entry) => [
			entry.kind,
			entry.path,
			entry.serverCount
		])
	});
	return {
		...summaryWithoutRepoPrompt,
		fingerprint,
		repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd)
	};
}
function loadMcpConfig(overridePath, cwd = process.cwd()) {
	let config = { mcpServers: {} };
	for (const source of getConfigSources(overridePath, cwd)) {
		const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
		if (!loaded) continue;
		config = mergeConfigs(config, expandImports(loaded, cwd));
	}
	return config;
}
function getConfigSources(overridePath, cwd = process.cwd()) {
	const userPath = getPiGlobalConfigPath(overridePath);
	const projectPath = getProjectConfigPath(cwd);
	const projectPiPath = getProjectPiConfigPath(cwd);
	const sources = [];
	if (GENERIC_GLOBAL_CONFIG_PATH !== userPath) sources.push({
		id: "shared-global",
		label: "user-global standard MCP",
		readPath: GENERIC_GLOBAL_CONFIG_PATH,
		writePath: userPath,
		kind: "import",
		importKind: "global MCP config",
		shared: true,
		scope: "global"
	});
	sources.push({
		id: "pi-global",
		label: "Pi global override",
		readPath: userPath,
		writePath: userPath,
		kind: "user",
		shared: false,
		scope: "global"
	});
	if (projectPath !== userPath) sources.push({
		id: "shared-project",
		label: "project standard MCP",
		readPath: projectPath,
		writePath: projectPath,
		kind: "project",
		shared: true,
		scope: "project"
	});
	if (projectPiPath !== userPath && projectPiPath !== projectPath) sources.push({
		id: "pi-project",
		label: "project Pi override",
		readPath: projectPiPath,
		writePath: projectPiPath,
		kind: "project",
		shared: false,
		scope: "project"
	});
	return sources;
}
function mergeConfigs(base, next) {
	return {
		mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
		imports: mergeImports(base.imports, next.imports),
		settings: next.settings ? {
			...base.settings,
			...next.settings
		} : base.settings
	};
}
function mergeServerMaps(base, next) {
	const merged = { ...base };
	for (const [name, definition] of Object.entries(next)) merged[name] = {
		...merged[name],
		...definition
	};
	return merged;
}
function mergeImports(left, right) {
	const merged = [...left ?? [], ...right ?? []];
	if (merged.length === 0) return void 0;
	return [...new Set(merged)];
}
function expandImports(config, cwd = process.cwd()) {
	if (!config.imports?.length) return config;
	const importedServers = {};
	for (const importKind of config.imports) {
		const importPath = resolveImportPath(importKind, cwd);
		if (!importPath) continue;
		try {
			const servers = extractServers(JSON.parse(readFileSync(importPath, "utf-8")), importKind);
			for (const [name, definition] of Object.entries(servers)) if (!importedServers[name]) importedServers[name] = definition;
		} catch (error) {
			console.warn(`Failed to import MCP config from ${importKind}:`, error);
		}
	}
	return {
		imports: config.imports,
		settings: config.settings,
		mcpServers: mergeServerMaps(importedServers, config.mcpServers)
	};
}
function resolveImportPath(importKind, cwd = process.cwd()) {
	const candidates = IMPORT_PATHS[importKind] ?? [];
	for (const candidate of candidates) {
		const fullPath = candidate.startsWith(".") ? resolve(cwd, candidate) : candidate;
		if (existsSync(fullPath)) return fullPath;
	}
	return null;
}
function getImportServerCount(importKind, path) {
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		return Object.keys(extractServers(raw, importKind)).length;
	} catch {
		return 0;
	}
}
function readValidatedConfig(path, label) {
	if (!existsSync(path)) return null;
	try {
		return validateConfig(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		console.warn(`Failed to load ${label}:`, error);
		return null;
	}
}
function validateConfig(raw) {
	if (!raw || typeof raw !== "object") return { mcpServers: {} };
	const obj = raw;
	const servers = obj.mcpServers ?? obj["mcp-servers"] ?? {};
	if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return { mcpServers: {} };
	return {
		mcpServers: servers,
		imports: Array.isArray(obj.imports) ? obj.imports : void 0,
		settings: obj.settings
	};
}
function extractServers(config, kind) {
	if (!config || typeof config !== "object") return {};
	const obj = config;
	let servers;
	switch (kind) {
		case "claude-desktop":
		case "claude-code":
		case "codex":
			servers = obj.mcpServers;
			break;
		case "cursor":
		case "windsurf":
		case "vscode":
			servers = obj.mcpServers ?? obj["mcp-servers"];
			break;
		default: return {};
	}
	if (!servers || typeof servers !== "object" || Array.isArray(servers)) return {};
	return servers;
}
function serializeRawConfig(raw) {
	return `${JSON.stringify(raw, null, 2)}\n`;
}
function buildUnifiedDiff(beforeText, afterText) {
	if (beforeText === afterText) return "(no changes)";
	const before = beforeText.split("\n");
	const after = afterText.split("\n");
	const rows = before.length;
	const cols = after.length;
	const lcs = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
	for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const lines = ["--- before", "+++ after"];
	let i = 0;
	let j = 0;
	while (i < rows || j < cols) {
		if (i < rows && j < cols && before[i] === after[j]) {
			lines.push(`  ${before[i]}`);
			i++;
			j++;
			continue;
		}
		if (j < cols && (i === rows || lcs[i][j + 1] >= lcs[i + 1][j])) {
			lines.push(`+ ${after[j]}`);
			j++;
			continue;
		}
		if (i < rows) {
			lines.push(`- ${before[i]}`);
			i++;
		}
	}
	return lines.join("\n");
}
function buildConfigWritePreview(filePath, nextRaw) {
	const existed = existsSync(filePath);
	const beforeRaw = readRawConfigObject(filePath);
	const beforeText = existed ? serializeRawConfig(beforeRaw) : "";
	const afterText = serializeRawConfig(nextRaw);
	return {
		path: filePath,
		existed,
		changed: beforeText !== afterText,
		beforeText,
		afterText,
		diffText: buildUnifiedDiff(beforeText, afterText)
	};
}
function readRawConfigObject(filePath) {
	if (!existsSync(filePath)) return {};
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf-8"));
		return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	} catch {
		return {};
	}
}
function writeRawConfigObject(filePath, raw) {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
	renameSync(tmpPath, filePath);
}
function getServersObject(raw) {
	const existing = raw.mcpServers ?? raw["mcp-servers"] ?? {};
	if (!existing || typeof existing !== "object" || Array.isArray(existing)) return {};
	return existing;
}
function setServersObject(raw, servers) {
	delete raw["mcp-servers"];
	raw.mcpServers = servers;
}
function isRepoPromptServer(name, entry) {
	const normalizedName = name.toLowerCase();
	if (normalizedName.includes("repoprompt") || normalizedName === "rp") return true;
	const command = entry.command?.toLowerCase() ?? "";
	if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) return true;
	return (entry.args ?? []).some((arg) => typeof arg === "string" && arg.toLowerCase().includes("repoprompt"));
}
function findProjectRoot(cwd = process.cwd()) {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git")) || existsSync(join(current, "package.json")) || existsSync(join(current, PROJECT_CONFIG_NAME)) || existsSync(join(current, ".pi"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function buildRepoPromptEntry(executablePath) {
	return {
		command: executablePath,
		args: [],
		lifecycle: "lazy"
	};
}
function detectRepoPrompt(summary, cwd = process.cwd()) {
	for (const source of summary.sources) {
		if (source.kind !== "shared" || source.serverCount === 0) continue;
		const config = readValidatedConfig(source.path, `MCP config from ${source.path}`);
		if (!config) continue;
		for (const [name, entry] of Object.entries(config.mcpServers)) if (isRepoPromptServer(name, entry)) return {
			configured: true,
			configuredPath: source.path
		};
	}
	const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
	if (!executablePath) return { configured: false };
	const projectRoot = findProjectRoot(cwd);
	return {
		configured: false,
		executablePath,
		targetPath: projectRoot ? join(projectRoot, PROJECT_CONFIG_NAME) : GENERIC_GLOBAL_CONFIG_PATH,
		serverName: "repoprompt",
		entry: buildRepoPromptEntry(executablePath)
	};
}
function previewCompatibilityImports(importKinds, overridePath) {
	const targetPath = getPiGlobalConfigPath(overridePath);
	const raw = readRawConfigObject(targetPath);
	const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
	const merged = [.../* @__PURE__ */ new Set([...currentImports, ...importKinds])];
	const nextRaw = {
		...raw,
		imports: merged
	};
	setServersObject(nextRaw, getServersObject(nextRaw));
	return buildConfigWritePreview(targetPath, nextRaw);
}
function ensureCompatibilityImports(importKinds, overridePath) {
	const targetPath = getPiGlobalConfigPath(overridePath);
	const raw = readRawConfigObject(targetPath);
	const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value) => typeof value === "string") : [];
	const merged = [.../* @__PURE__ */ new Set([...currentImports, ...importKinds])];
	const added = merged.filter((kind) => !currentImports.includes(kind));
	if (added.length === 0) return {
		path: targetPath,
		added: []
	};
	raw.imports = merged;
	setServersObject(raw, getServersObject(raw));
	writeRawConfigObject(targetPath, raw);
	return {
		path: targetPath,
		added
	};
}
function buildStarterProjectConfig() {
	return { mcpServers: {} };
}
function previewStarterProjectConfig(cwd = process.cwd()) {
	return buildConfigWritePreview(getProjectConfigPath(cwd), { mcpServers: buildStarterProjectConfig().mcpServers });
}
function writeStarterProjectConfig(cwd = process.cwd()) {
	const targetPath = getProjectConfigPath(cwd);
	writeRawConfigObject(targetPath, { mcpServers: buildStarterProjectConfig().mcpServers });
	return targetPath;
}
function previewSharedServerEntry(filePath, serverName, entry) {
	const nextRaw = { ...readRawConfigObject(filePath) };
	const servers = getServersObject(nextRaw);
	servers[serverName] = entry;
	setServersObject(nextRaw, servers);
	return buildConfigWritePreview(filePath, nextRaw);
}
function writeSharedServerEntry(filePath, serverName, entry) {
	const raw = readRawConfigObject(filePath);
	const servers = getServersObject(raw);
	servers[serverName] = entry;
	setServersObject(raw, servers);
	writeRawConfigObject(filePath, raw);
	return filePath;
}
function getServerProvenance(overridePath, cwd = process.cwd()) {
	const provenance = /* @__PURE__ */ new Map();
	const userPath = getPiGlobalConfigPath(overridePath);
	for (const source of getConfigSources(overridePath, cwd)) {
		const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
		if (!loaded) continue;
		if (loaded.imports?.length) for (const importKind of loaded.imports) {
			const importPath = resolveImportPath(importKind, cwd);
			if (!importPath) continue;
			try {
				const servers = extractServers(JSON.parse(readFileSync(importPath, "utf-8")), importKind);
				for (const name of Object.keys(servers)) if (!provenance.has(name)) provenance.set(name, {
					path: userPath,
					kind: "import",
					importKind
				});
			} catch {}
		}
		for (const name of Object.keys(loaded.mcpServers)) provenance.set(name, {
			path: source.writePath,
			kind: source.kind,
			importKind: source.importKind
		});
	}
	return provenance;
}
function writeDirectToolsConfig(changes, provenance, fullConfig) {
	const byPath = /* @__PURE__ */ new Map();
	for (const [serverName, value] of changes) {
		const prov = provenance.get(serverName);
		if (!prov) continue;
		const targetPath = prov.path;
		if (!byPath.has(targetPath)) byPath.set(targetPath, []);
		byPath.get(targetPath).push({
			name: serverName,
			value,
			prov
		});
	}
	for (const [filePath, entries] of byPath) {
		const raw = readRawConfigObject(filePath);
		const servers = getServersObject(raw);
		for (const { name, value, prov } of entries) if (prov.kind === "import") {
			const fullDef = fullConfig.mcpServers[name];
			if (fullDef) servers[name] = {
				...fullDef,
				directTools: value
			};
		} else if (servers[name]) servers[name] = {
			...servers[name],
			directTools: value
		};
		setServersObject(raw, servers);
		writeRawConfigObject(filePath, raw);
	}
}
//#endregion
export { buildStarterProjectConfig, ensureCompatibilityImports, findAvailableImportConfigs, getConfigDiscoveryPaths, getGenericGlobalConfigPath, getMcpDiscoverySummary, getPiGlobalConfigPath, getProjectConfigPath, getProjectPiConfigPath, getServerProvenance, loadMcpConfig, previewCompatibilityImports, previewSharedServerEntry, previewStarterProjectConfig, writeDirectToolsConfig, writeSharedServerEntry, writeStarterProjectConfig };
