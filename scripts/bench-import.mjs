// ABOUTME: Cold-process jiti import timer for the extension factory entrypoint.
// ABOUTME: Reports import_ms for index.ts (or --probe=<module>) under a fresh process.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function resolveJitiEntry() {
  const candidates = [
    join(root, "node_modules/jiti/lib/jiti.mjs"),
    join(root, "node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    return require.resolve("jiti/lib/jiti.mjs");
  } catch {
    // fall through
  }
  throw new Error(
    "Unable to resolve jiti. Install dependencies (npm install) so jiti is available via pi-coding-agent or as a direct dependency.",
  );
}

function parseProbeArg(argv) {
  const probeFlag = argv.find((arg) => arg.startsWith("--probe="));
  if (!probeFlag) return null;
  const value = probeFlag.slice("--probe=".length).trim();
  return value.length > 0 ? value : null;
}

const probe = parseProbeArg(process.argv.slice(2));
const targetRelative = probe ?? "./index.ts";
const targetPath = resolve(root, targetRelative);

const { createJiti } = await import(pathToFileURL(resolveJitiEntry()).href);
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
});

const startedAt = performance.now();
const imported = await jiti.import(targetPath, { default: true });
const importMs = performance.now() - startedAt;

const defaultExport = imported?.default ?? imported;
console.log(`target=${targetRelative}`);
console.log(`import_ms=${importMs.toFixed(1)}`);
console.log(`factory_type=${typeof defaultExport}`);
