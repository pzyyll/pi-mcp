// ABOUTME: Process-wide bridge for host-provided @earendil-works peer packages.
// ABOUTME: Seeded under jiti; lazy native ESM chunks read here without re-resolving peers.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Minimal pi-tui surface used by the adapter (keeps the bridge small). */
export interface HostPiTui {
  matchesKey: (data: string, key: string) => boolean;
  truncateToWidth: (text: string, width: number, ellipsis?: string, pad?: boolean) => string;
  visibleWidth: (text: string) => number;
  // Constructor shape only — full pi-tui Text API is unused beyond construction.
  Text: new (text: string, x: number, y: number) => unknown;
}

/** Minimal pi-ai surface used by sampling. */
export interface HostPiAi {
  // complete() lives on the compat entry (pi jiti aliases @earendil-works/pi-ai → compat).
  complete: typeof import("@earendil-works/pi-ai/compat").complete;
}

interface HostPeerStore {
  piTui?: HostPiTui;
  piAi?: HostPiAi;
  piTuiPromise?: Promise<HostPiTui>;
  piAiPromise?: Promise<HostPiAi>;
}

const HOST_PEER_STORE_KEY = Symbol.for("pi-mcp-adapter.host-peers");

/** Walk this many parents from each require-root when hunting node_modules. */
const HOST_PACKAGE_PARENT_WALK_DEPTH = 10;

function getStore(): HostPeerStore {
  const globalRef = globalThis as typeof globalThis & {
    [HOST_PEER_STORE_KEY]?: HostPeerStore;
  };
  if (!globalRef[HOST_PEER_STORE_KEY]) {
    globalRef[HOST_PEER_STORE_KEY] = {};
  }
  return globalRef[HOST_PEER_STORE_KEY];
}

export function seedHostPiTui(peers: HostPiTui): void {
  getStore().piTui = peers;
}

export function seedHostPiAi(peers: HostPiAi): void {
  getStore().piAi = peers;
}

export function getHostPiTui(): HostPiTui {
  const peers = getStore().piTui;
  if (!peers) {
    throw new Error(
      "Host @earendil-works/pi-tui peers are not seeded. The extension entry must import seed-host-pi-tui before panel code runs.",
    );
  }
  return peers;
}

export function getHostPiAi(): HostPiAi {
  const peers = getStore().piAi;
  if (!peers) {
    throw new Error(
      "Host @earendil-works/pi-ai peers are not seeded. Call ensureHostPiAi() before sampling.",
    );
  }
  return peers;
}

/** Roots used to discover the running pi install's node_modules tree. */
function hostSearchRoots(): string[] {
  const roots: string[] = [];
  if (typeof process.argv[1] === "string" && process.argv[1].length > 0) {
    roots.push(process.argv[1]);
  }
  try {
    roots.push(fileURLToPath(import.meta.url));
  } catch {
    // ignore non-file import.meta.url
  }
  if (typeof process.cwd === "function") {
    roots.push(process.cwd());
  }
  return roots;
}

function packageDirCandidates(packageName: string): string[] {
  const parts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  const out: string[] = [];
  for (const root of hostSearchRoots()) {
    let dir = dirname(root);
    for (let depth = 0; depth < HOST_PACKAGE_PARENT_WALK_DEPTH; depth++) {
      out.push(join(dir, "node_modules", ...parts));
      // Nested under pi-coding-agent (npm may hoist peers here only).
      out.push(
        join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", ...parts),
      );
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return out;
}

function findHostPackageDir(packageName: string): string | null {
  for (const candidate of packageDirCandidates(packageName)) {
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}

async function importHostPackageFile<T>(
  packageName: string,
  entryRelativePath: string,
): Promise<T> {
  const packageDir = findHostPackageDir(packageName);
  if (!packageDir) {
    throw new Error(
      `Cannot resolve host package ${packageName} (not installed next to the running pi binary, and bare import failed).`,
    );
  }
  const entryPath = join(packageDir, entryRelativePath);
  if (!existsSync(entryPath)) {
    throw new Error(
      `Host package ${packageName} found at ${packageDir} but missing ${entryRelativePath}.`,
    );
  }
  return (await import(pathToFileURL(entryPath).href)) as T;
}

async function importPackageEntry<T>(packageName: string, entryRelativePath: string): Promise<T> {
  try {
    return (await import(packageName)) as T;
  } catch {
    // Native resolve from the extension install dir cannot see host peers.
  }
  return importHostPackageFile(packageName, entryRelativePath);
}

function toHostPiTui(mod: Record<string, unknown>): HostPiTui {
  const { matchesKey, truncateToWidth, visibleWidth, Text } = mod;
  if (
    typeof matchesKey !== "function" ||
    typeof truncateToWidth !== "function" ||
    typeof visibleWidth !== "function" ||
    typeof Text !== "function"
  ) {
    throw new Error("Host @earendil-works/pi-tui module is missing required exports");
  }
  return {
    matchesKey: matchesKey as HostPiTui["matchesKey"],
    truncateToWidth: truncateToWidth as HostPiTui["truncateToWidth"],
    visibleWidth: visibleWidth as HostPiTui["visibleWidth"],
    Text: Text as HostPiTui["Text"],
  };
}

function toHostPiAi(mod: Record<string, unknown>): HostPiAi {
  const { complete } = mod;
  if (typeof complete !== "function") {
    throw new Error("Host @earendil-works/pi-ai module is missing complete()");
  }
  return { complete: complete as HostPiAi["complete"] };
}

/**
 * Ensure pi-tui peers are available (seed or host-path resolve).
 * Prefer seedHostPiTui from the jiti entry for cold paths that need sync access.
 */
export async function ensureHostPiTui(): Promise<HostPiTui> {
  const store = getStore();
  if (store.piTui) return store.piTui;
  if (!store.piTuiPromise) {
    store.piTuiPromise = importPackageEntry<Record<string, unknown>>(
      "@earendil-works/pi-tui",
      "dist/index.js",
    )
      .then((mod) => {
        const peers = toHostPiTui(mod);
        store.piTui = peers;
        return peers;
      })
      .finally(() => {
        store.piTuiPromise = undefined;
      });
  }
  return store.piTuiPromise;
}

/**
 * Load pi-ai complete() from the compat surface (or host install fallback).
 * Tries bare import first (jiti alias / vitest mock), then filesystem dist/compat.js.
 */
async function importPiAiCompatModule(): Promise<Record<string, unknown>> {
  // Prefer compat: main entry no longer exports complete() in pi-ai 0.81+.
  try {
    return (await import("@earendil-works/pi-ai/compat")) as Record<string, unknown>;
  } catch {
    // fall through
  }
  // Tests may mock the package root; accept it if complete is present.
  try {
    const root = (await import("@earendil-works/pi-ai")) as Record<string, unknown>;
    if (typeof root.complete === "function") return root;
  } catch {
    // fall through
  }
  // Do not bare-import the package root here: it resolves without complete().
  return importHostPackageFile<Record<string, unknown>>("@earendil-works/pi-ai", "dist/compat.js");
}

/** Ensure pi-ai peers are available without putting them on the eager import graph. */
export async function ensureHostPiAi(): Promise<HostPiAi> {
  const store = getStore();
  if (store.piAi) return store.piAi;
  if (!store.piAiPromise) {
    store.piAiPromise = importPiAiCompatModule()
      .then((mod) => {
        const peers = toHostPiAi(mod);
        store.piAi = peers;
        return peers;
      })
      .finally(() => {
        store.piAiPromise = undefined;
      });
  }
  return store.piAiPromise;
}

/** Test helper: clear seeded peers (does not unload node modules). */
export function resetHostPeersForTests(): void {
  const store = getStore();
  store.piTui = undefined;
  store.piAi = undefined;
  store.piTuiPromise = undefined;
  store.piAiPromise = undefined;
}
