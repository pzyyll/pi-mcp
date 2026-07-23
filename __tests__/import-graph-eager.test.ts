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
  // Panel modules stay lazy; peers reach them via host-peers, not static entry imports.
  "./mcp-panel.ts",
  "./mcp-setup-panel.ts",
] as const;

describe("factory eager import graph", () => {
  it("does not statically import banned heavy modules from index.ts", () => {
    const staticImports = listStaticImportSpecifiers(indexSource);
    const bannedHits = staticImports.filter((specifier) =>
      BANNED_STATIC_IMPORTS.some(
        (banned) =>
          specifier === banned ||
          specifier.startsWith(`${banned}/`) ||
          specifier.startsWith(`${banned}.`),
      ),
    );
    expect(bannedHits).toEqual([]);
  });

  it("seeds host pi-tui peers from the entry graph for lazy panel chunks", () => {
    const staticImports = listStaticImportSpecifiers(indexSource);
    expect(staticImports).toContain("./seed-host-pi-tui.ts");

    // Lazy panel modules must not re-import the peer package (native dynamic import breaks).
    for (const relative of ["./panel-keys.ts", "./mcp-panel.ts", "./mcp-setup-panel.ts"] as const) {
      const source = readFileSync(join(srcDir, relative.replace("./", "")), "utf-8");
      const imports = listStaticImportSpecifiers(source);
      expect(
        imports.some(
          (s) => s === "@earendil-works/pi-tui" || s.startsWith("@earendil-works/pi-tui/"),
        ),
        `${relative} must not import @earendil-works/pi-tui`,
      ).toBe(false);
    }
  });

  it("keeps resolve helpers on a light path without heavy runtime packages", () => {
    const resolveSource = readFileSync(join(srcDir, "direct-tools-resolve.ts"), "utf-8");
    const schemaSource = readFileSync(join(srcDir, "schema-format.ts"), "utf-8");
    const registerSource = readFileSync(join(srcDir, "direct-tool-register.ts"), "utf-8");
    const metadataSource = readFileSync(join(srcDir, "metadata-cache.ts"), "utf-8");
    const toolNamesSource = readFileSync(join(srcDir, "tool-names.ts"), "utf-8");

    for (const [label, source] of [
      ["direct-tools-resolve.ts", resolveSource],
      ["schema-format.ts", schemaSource],
      ["metadata-cache.ts", metadataSource],
      ["tool-names.ts", toolNamesSource],
    ] as const) {
      const imports = listStaticImportSpecifiers(source);
      for (const banned of [
        "recheck",
        "@modelcontextprotocol/sdk",
        "typebox",
        "zod",
        "@earendil-works/pi-ai",
        "./ui-stream-types.ts",
      ] as const) {
        expect(
          imports.some((s) => s === banned || s.startsWith(`${banned}/`)),
          `${label} bans ${banned}`,
        ).toBe(false);
      }
    }

    // Cold naming helpers must come from tool-names, not types (avoids stream re-export traps).
    const resolveImports = listStaticImportSpecifiers(resolveSource);
    const metadataImports = listStaticImportSpecifiers(metadataSource);
    expect(resolveImports).toContain("./tool-names.ts");
    expect(metadataImports).toContain("./tool-names.ts");

    const registerImports = listStaticImportSpecifiers(registerSource);
    // P0/P1 keep Pi-official TypeBox parameters; typebox stays on the register module only.
    expect(registerImports.some((s) => s === "typebox" || s.startsWith("typebox/"))).toBe(true);
    for (const banned of [
      "recheck",
      "@modelcontextprotocol/sdk",
      "@earendil-works/pi-ai",
    ] as const) {
      expect(registerImports.some((s) => s === banned || s.startsWith(`${banned}/`))).toBe(false);
    }
  });
});
