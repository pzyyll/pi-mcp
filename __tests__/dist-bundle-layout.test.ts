// ABOUTME: Guards split-bundle dist layout after the cold-start entry build.
// ABOUTME: Asserts entry, app-bridge asset, and banned static package imports.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, "dist");
const distEntry = join(distDir, "index.js");
const appBridge = join(distDir, "app-bridge.bundle.js");

/** Static import/export-from specifiers at module top level (no dynamic import()). */
function listStaticImportSpecifiers(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  const specifiers: string[] = [];
  const importRe = /^\s*import\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']\s*;?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(withoutLineComments)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

const BANNED_ENTRY_PACKAGES = [
  "recheck",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/ext-apps",
  "@earendil-works/pi-ai",
  "typebox",
  "zod",
] as const;

describe("dist bundle layout", () => {
  it("keeps the published entry and app-bridge asset when dist exists", () => {
    if (!existsSync(distDir)) return;

    expect(existsSync(distEntry)).toBe(true);
    expect(existsSync(appBridge)).toBe(true);
    expect(readdirSync(distDir).some((name) => name.endsWith(".js"))).toBe(true);
  });

  it("does not statically import banned heavy packages from dist/index.js", () => {
    if (!existsSync(distEntry)) return;

    const staticImports = listStaticImportSpecifiers(readFileSync(distEntry, "utf-8"));
    const bannedHits = staticImports.filter((specifier) =>
      BANNED_ENTRY_PACKAGES.some(
        (banned) =>
          specifier === banned ||
          specifier.startsWith(`${banned}/`) ||
          specifier.startsWith(`${banned}.`),
      ),
    );
    expect(bannedHits).toEqual([]);
  });

  it("exports a factory function from the native dist entry", async () => {
    if (!existsSync(distEntry)) return;

    const imported = await import(pathToFileURL(distEntry).href);
    const factory = imported.default ?? imported;
    expect(typeof factory).toBe("function");
  });
});
