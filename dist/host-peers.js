import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region src/host-peers.ts
const HOST_PEER_STORE_KEY = Symbol.for("pi-mcp-adapter.host-peers");
/** Walk this many parents from each require-root when hunting node_modules. */
const HOST_PACKAGE_PARENT_WALK_DEPTH = 10;
function getStore() {
	const globalRef = globalThis;
	if (!globalRef[HOST_PEER_STORE_KEY]) globalRef[HOST_PEER_STORE_KEY] = {};
	return globalRef[HOST_PEER_STORE_KEY];
}
function seedHostPiTui(peers) {
	getStore().piTui = peers;
}
function getHostPiTui() {
	const peers = getStore().piTui;
	if (!peers) throw new Error("Host @earendil-works/pi-tui peers are not seeded. The extension entry must import seed-host-pi-tui before panel code runs.");
	return peers;
}
/** Roots used to discover the running pi install's node_modules tree. */
function hostSearchRoots() {
	const roots = [];
	if (typeof process.argv[1] === "string" && process.argv[1].length > 0) roots.push(process.argv[1]);
	try {
		roots.push(fileURLToPath(import.meta.url));
	} catch {}
	if (typeof process.cwd === "function") roots.push(process.cwd());
	return roots;
}
function packageDirCandidates(packageName) {
	const parts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
	const out = [];
	for (const root of hostSearchRoots()) {
		let dir = dirname(root);
		for (let depth = 0; depth < HOST_PACKAGE_PARENT_WALK_DEPTH; depth++) {
			out.push(join(dir, "node_modules", ...parts));
			out.push(join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", ...parts));
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return out;
}
function findHostPackageDir(packageName) {
	for (const candidate of packageDirCandidates(packageName)) if (existsSync(join(candidate, "package.json"))) return candidate;
	return null;
}
async function importHostPackageFile(packageName, entryRelativePath) {
	const packageDir = findHostPackageDir(packageName);
	if (!packageDir) throw new Error(`Cannot resolve host package ${packageName} (not installed next to the running pi binary, and bare import failed).`);
	const entryPath = join(packageDir, entryRelativePath);
	if (!existsSync(entryPath)) throw new Error(`Host package ${packageName} found at ${packageDir} but missing ${entryRelativePath}.`);
	return await import(pathToFileURL(entryPath).href);
}
async function importPackageEntry(packageName, entryRelativePath) {
	try {
		return await import(packageName);
	} catch {}
	return importHostPackageFile(packageName, entryRelativePath);
}
function toHostPiTui(mod) {
	const { matchesKey, truncateToWidth, visibleWidth, Text } = mod;
	if (typeof matchesKey !== "function" || typeof truncateToWidth !== "function" || typeof visibleWidth !== "function" || typeof Text !== "function") throw new Error("Host @earendil-works/pi-tui module is missing required exports");
	return {
		matchesKey,
		truncateToWidth,
		visibleWidth,
		Text
	};
}
function toHostPiAi(mod) {
	const { complete } = mod;
	if (typeof complete !== "function") throw new Error("Host @earendil-works/pi-ai module is missing complete()");
	return { complete };
}
/**
* Ensure pi-tui peers are available (seed or host-path resolve).
* Prefer seedHostPiTui from the jiti entry for cold paths that need sync access.
*/
async function ensureHostPiTui() {
	const store = getStore();
	if (store.piTui) return store.piTui;
	if (!store.piTuiPromise) store.piTuiPromise = importPackageEntry("@earendil-works/pi-tui", "dist/index.js").then((mod) => {
		const peers = toHostPiTui(mod);
		store.piTui = peers;
		return peers;
	}).finally(() => {
		store.piTuiPromise = void 0;
	});
	return store.piTuiPromise;
}
/**
* Load pi-ai complete() from the compat surface (or host install fallback).
* Tries bare import first (jiti alias / vitest mock), then filesystem dist/compat.js.
*/
async function importPiAiCompatModule() {
	try {
		return await import("@earendil-works/pi-ai/compat");
	} catch {}
	try {
		const root = await import("@earendil-works/pi-ai");
		if (typeof root.complete === "function") return root;
	} catch {}
	return importHostPackageFile("@earendil-works/pi-ai", "dist/compat.js");
}
/** Ensure pi-ai peers are available without putting them on the eager import graph. */
async function ensureHostPiAi() {
	const store = getStore();
	if (store.piAi) return store.piAi;
	if (!store.piAiPromise) store.piAiPromise = importPiAiCompatModule().then((mod) => {
		const peers = toHostPiAi(mod);
		store.piAi = peers;
		return peers;
	}).finally(() => {
		store.piAiPromise = void 0;
	});
	return store.piAiPromise;
}
//#endregion
export { seedHostPiTui as i, ensureHostPiTui as n, getHostPiTui as r, ensureHostPiAi as t };
