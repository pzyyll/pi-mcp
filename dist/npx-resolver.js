import { getAgentPath } from "./agent-dir.js";
import { dirname, extname, join, resolve, sep } from "node:path";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
//#region src/npx-resolver.ts
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 1440 * 60 * 1e3;
async function resolveNpxBinary(command, args) {
	const parsed = command === "npx" ? parseNpxArgs(args) : command === "npm" ? parseNpmExecArgs(args) : null;
	if (!parsed) return null;
	const cacheKey = JSON.stringify([command, ...args]);
	const cached = loadCache()?.entries?.[cacheKey];
	if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS && existsSync(cached.resolvedBin)) return {
		binPath: cached.resolvedBin,
		extraArgs: parsed.extraArgs,
		isJs: cached.isJs
	};
	const resolved = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
	if (resolved) {
		saveCacheEntry(cacheKey, resolved);
		return {
			binPath: resolved.resolvedBin,
			extraArgs: parsed.extraArgs,
			isJs: resolved.isJs
		};
	}
	await forceNpxCache(parsed.packageSpec);
	const resolvedAfterInstall = resolveFromNpmCache(parsed.packageSpec, parsed.binName);
	if (resolvedAfterInstall) {
		saveCacheEntry(cacheKey, resolvedAfterInstall);
		return {
			binPath: resolvedAfterInstall.resolvedBin,
			extraArgs: parsed.extraArgs,
			isJs: resolvedAfterInstall.isJs
		};
	}
	return null;
}
function parseNpxArgs(args) {
	const separatorIndex = args.indexOf("--");
	const before = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
	const after = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
	const positionals = [];
	let packageSpec;
	let sawPackageFlag = false;
	let foundFirstPositional = false;
	for (let i = 0; i < before.length; i++) {
		const arg = before[i];
		if (foundFirstPositional) {
			positionals.push(arg);
			continue;
		}
		if (arg === "-y" || arg === "--yes") continue;
		if (arg === "-p" || arg === "--package") {
			const value = before[i + 1];
			if (!value || value.startsWith("-")) return null;
			if (!packageSpec) packageSpec = value;
			sawPackageFlag = true;
			i++;
			continue;
		}
		if (arg.startsWith("--package=")) {
			const value = arg.slice(10);
			if (!value) return null;
			if (!packageSpec) packageSpec = value;
			sawPackageFlag = true;
			continue;
		}
		if (arg.startsWith("-")) return null;
		positionals.push(arg);
		foundFirstPositional = true;
	}
	const separatedAfter = separatorIndex >= 0 && after.length > 0 ? ["--", ...after] : after;
	if (sawPackageFlag) {
		const binName = positionals[0];
		if (!packageSpec || !binName) return null;
		const extraArgs = positionals.slice(1).concat(separatedAfter);
		return {
			packageSpec,
			binName,
			extraArgs
		};
	}
	const packagePositional = positionals[0];
	if (!packagePositional) return null;
	return {
		packageSpec: packagePositional,
		extraArgs: positionals.slice(1).concat(separatedAfter)
	};
}
function parseNpmExecArgs(args) {
	if (args[0] !== "exec") return null;
	const execArgs = args.slice(1);
	const separatorIndex = execArgs.indexOf("--");
	if (separatorIndex < 0) return null;
	const before = execArgs.slice(0, separatorIndex);
	const after = execArgs.slice(separatorIndex + 1);
	let packageSpec;
	for (let i = 0; i < before.length; i++) {
		const arg = before[i];
		if (arg === "-y" || arg === "--yes") continue;
		if (arg === "--package") {
			const value = before[i + 1];
			if (!value || value.startsWith("-")) return null;
			if (!packageSpec) packageSpec = value;
			i++;
			continue;
		}
		if (arg.startsWith("--package=")) {
			const value = arg.slice(10);
			if (!value) return null;
			if (!packageSpec) packageSpec = value;
			continue;
		}
		if (arg.startsWith("-")) return null;
	}
	const binName = after[0];
	if (!packageSpec || !binName) return null;
	const extraArgs = after.slice(1);
	return {
		packageSpec,
		binName,
		extraArgs
	};
}
function resolveFromNpmCache(packageSpec, binName) {
	const cacheDir = getNpmCacheDir();
	if (!cacheDir) return null;
	const packageName = extractPackageName(packageSpec);
	if (!packageName) return null;
	const packageDir = findCachedPackageDir(cacheDir, packageName);
	if (!packageDir) return null;
	const packageJsonPath = join(packageDir, "package.json");
	if (!existsSync(packageJsonPath)) return null;
	let pkg = null;
	try {
		pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	} catch {
		return null;
	}
	const binField = pkg?.bin;
	if (!binField) return null;
	const candidates = buildBinCandidates(packageName, binName);
	let chosenBinName;
	let binRel;
	if (typeof binField === "string") {
		chosenBinName = defaultBinName(packageName);
		binRel = binField;
	} else {
		for (const candidate of candidates) if (binField[candidate]) {
			chosenBinName = candidate;
			binRel = binField[candidate];
			break;
		}
		if (!binRel) {
			const firstEntry = Object.entries(binField)[0];
			if (firstEntry) {
				chosenBinName = firstEntry[0];
				binRel = firstEntry[1];
			}
		}
	}
	if (!binRel) return null;
	const nodeModulesDir = findNodeModulesDir(packageDir);
	const binLink = chosenBinName ? join(nodeModulesDir, ".bin", chosenBinName) : null;
	let resolvedBin = binLink && existsSync(binLink) ? safeRealpath(binLink) : "";
	if (!resolvedBin) {
		resolvedBin = resolve(packageDir, binRel);
		if (!existsSync(resolvedBin)) return null;
	}
	const isJs = detectJsBinary(resolvedBin);
	return {
		resolvedBin,
		resolvedAt: Date.now(),
		packageVersion: pkg?.version,
		isJs
	};
}
const FORCE_CACHE_TIMEOUT_MS = 3e4;
async function forceNpxCache(packageSpec) {
	try {
		await new Promise((resolve, reject) => {
			const proc = spawn("npm", [
				"exec",
				"--yes",
				"--package",
				packageSpec,
				"--",
				"node",
				"-e",
				"1"
			], { stdio: "ignore" });
			const timer = setTimeout(() => {
				proc.kill();
				reject(/* @__PURE__ */ new Error("timeout"));
			}, FORCE_CACHE_TIMEOUT_MS);
			timer.unref();
			proc.on("close", () => {
				clearTimeout(timer);
				resolve();
			});
			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	} catch {}
}
function buildBinCandidates(packageName, explicitBin) {
	const candidates = [];
	if (explicitBin) candidates.push(explicitBin);
	if (packageName.startsWith("@")) {
		const namePart = packageName.split("/")[1] ?? "";
		const scopePart = packageName.split("/")[0]?.replace("@", "") ?? "";
		if (namePart) candidates.push(namePart);
		if (scopePart && namePart) candidates.push(`${scopePart}-${namePart}`);
	} else candidates.push(packageName);
	return [...new Set(candidates.filter(Boolean))];
}
function extractPackageName(spec) {
	const trimmed = spec.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("@")) {
		const slashIndex = trimmed.indexOf("/");
		if (slashIndex < 0) return null;
		const atIndex = trimmed.lastIndexOf("@");
		if (atIndex > slashIndex) return trimmed.slice(0, atIndex);
		return trimmed;
	}
	const atIndex = trimmed.indexOf("@");
	return atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed;
}
function defaultBinName(packageName) {
	if (packageName.startsWith("@")) return packageName.split("/")[1] ?? packageName.replace("@", "").replace("/", "-");
	return packageName;
}
function findCachedPackageDir(cacheDir, packageName) {
	const npxDir = join(cacheDir, "_npx");
	if (!existsSync(npxDir)) return null;
	const packagePathParts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
	const candidates = readdirSync(npxDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
		const mtime = safeStatMtime(join(npxDir, entry.name));
		return {
			name: entry.name,
			mtime
		};
	}).sort((a, b) => b.mtime - a.mtime);
	for (const entry of candidates) {
		const pkgDir = join(npxDir, entry.name, "node_modules", ...packagePathParts);
		if (existsSync(join(pkgDir, "package.json"))) return pkgDir;
	}
	return null;
}
function findNodeModulesDir(packageDir) {
	const parts = packageDir.split(sep);
	const idx = parts.lastIndexOf("node_modules");
	if (idx >= 0) return parts.slice(0, idx + 1).join(sep);
	return join(packageDir, "..");
}
function detectJsBinary(binPath) {
	const ext = extname(binPath).toLowerCase();
	if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return true;
	try {
		const fd = openSync(binPath, "r");
		try {
			const buf = Buffer.alloc(256);
			readSync(fd, buf, 0, 256, 0);
			const firstLine = buf.toString("utf-8").split("\n")[0] ?? "";
			return firstLine.startsWith("#!") && firstLine.includes("node");
		} finally {
			closeSync(fd);
		}
	} catch {
		return false;
	}
}
let npmCacheDirCached;
function getNpmCacheDir() {
	if (npmCacheDirCached !== void 0) return npmCacheDirCached;
	if (process.env.NPM_CONFIG_CACHE) {
		npmCacheDirCached = process.env.NPM_CONFIG_CACHE;
		return npmCacheDirCached;
	}
	try {
		const result = spawnSync("npm", [
			"config",
			"get",
			"cache"
		], { encoding: "utf-8" });
		if (result.status === 0) {
			npmCacheDirCached = String(result.stdout).trim() || null;
			return npmCacheDirCached;
		}
	} catch {
		npmCacheDirCached = null;
		return null;
	}
	npmCacheDirCached = null;
	return null;
}
function getNpxCachePath() {
	return getAgentPath("mcp-npx-cache.json");
}
function loadCache() {
	const cachePath = getNpxCachePath();
	if (!existsSync(cachePath)) return null;
	try {
		const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
		if (!raw || typeof raw !== "object") return null;
		if (raw.version !== CACHE_VERSION) return null;
		if (!raw.entries || typeof raw.entries !== "object") return null;
		return raw;
	} catch {
		return null;
	}
}
function saveCacheEntry(key, entry) {
	const cachePath = getNpxCachePath();
	mkdirSync(dirname(cachePath), { recursive: true });
	let merged = {
		version: CACHE_VERSION,
		entries: {}
	};
	try {
		if (existsSync(cachePath)) {
			const existing = JSON.parse(readFileSync(cachePath, "utf-8"));
			if (existing && existing.version === CACHE_VERSION && existing.entries) merged.entries = { ...existing.entries };
		}
	} catch {}
	merged.entries[key] = entry;
	const tmpPath = `${cachePath}.${process.pid}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
	renameSync(tmpPath, cachePath);
}
function safeRealpath(path) {
	try {
		return realpathSync(path);
	} catch {
		return "";
	}
}
function safeStatMtime(path) {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}
//#endregion
export { resolveNpxBinary };
