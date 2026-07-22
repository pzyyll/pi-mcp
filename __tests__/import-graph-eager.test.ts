// ABOUTME: Guardrail that keeps heavy runtime modules off the factory static import graph.
// ABOUTME: Parses index.ts top-level import specifiers only (not a full graph solver).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(repoRoot, "src");
const indexSource = readFileSync(join(srcDir, "index.ts"), "utf-8");

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

const BANNED_STATIC_IMPORTS = [
  "recheck",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/ext-apps",
  "@earendil-works/pi-ai",
  "typebox",
  "./server-manager.ts",
  "./sampling-handler.ts",
  "./elicitation-handler.ts",
  "./ui-server.ts",
  "./proxy-modes.ts",
  "./init.ts",
  "./mcp-auth-flow.ts",
  "./commands.ts",
  "./direct-tools.ts",
] as const;

describe("factory eager import graph", () => {
  it("does not statically import banned heavy modules from index.ts", () => {
    const staticImports = listStaticImportSpecifiers(indexSource);
    const bannedHits = staticImports.filter((specifier) =>
      BANNED_STATIC_IMPORTS.some((banned) =>
        specifier === banned || specifier.startsWith(`${banned}/`) || specifier.startsWith(`${banned}.`),
      ),
    );
    expect(bannedHits).toEqual([]);
  });

  it("keeps resolve helpers on a light path without heavy runtime packages", () => {
    const resolveSource = readFileSync(join(srcDir, "direct-tools-resolve.ts"), "utf-8");
    const schemaSource = readFileSync(join(srcDir, "schema-format.ts"), "utf-8");
    const registerSource = readFileSync(join(srcDir, "direct-tool-register.ts"), "utf-8");

    for (const [label, source] of [
      ["direct-tools-resolve.ts", resolveSource],
      ["schema-format.ts", schemaSource],
    ] as const) {
      const imports = listStaticImportSpecifiers(source);
      expect(imports, label).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/@modelcontextprotocol\/sdk|recheck|typebox|@earendil-works\/pi-ai/),
      ]));
      for (const banned of ["recheck", "@modelcontextprotocol/sdk", "typebox", "@earendil-works/pi-ai"] as const) {
        expect(imports.some((s) => s === banned || s.startsWith(`${banned}/`)), `${label} bans ${banned}`).toBe(false);
      }
    }

    const registerImports = listStaticImportSpecifiers(registerSource);
    expect(registerImports.some((s) => s === "typebox" || s.startsWith("typebox/"))).toBe(true);
    for (const banned of ["recheck", "@modelcontextprotocol/sdk", "@earendil-works/pi-ai"] as const) {
      expect(registerImports.some((s) => s === banned || s.startsWith(`${banned}/`))).toBe(false);
    }
  });
});
