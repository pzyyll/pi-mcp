// ABOUTME: Guards package publish surface for the prebuilt dist-based Pi extension.
// ABOUTME: Ensures pi.extensions points at dist and published files stay minimal.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
  files?: string[];
  pi?: { extensions?: string[] };
};

const PUBLISHED_PATHS = new Set(packageJson.files ?? []);
const DIST_EXTENSION_ENTRY = "./dist/index.js";

describe("package.json publish surface", () => {
  it("points Pi at the prebuilt extension entry", () => {
    expect(packageJson.pi?.extensions).toEqual([DIST_EXTENSION_ENTRY]);
  });

  it("publishes dist artifacts and package metadata, not raw TypeScript sources", () => {
    expect(PUBLISHED_PATHS.has("dist")).toBe(true);
    expect(PUBLISHED_PATHS.has("cli.js")).toBe(true);
    expect(PUBLISHED_PATHS.has("banner.png")).toBe(true);
    expect(PUBLISHED_PATHS.has("README.md")).toBe(true);
    expect(PUBLISHED_PATHS.has("CHANGELOG.md")).toBe(true);
    expect(PUBLISHED_PATHS.has("LICENSE")).toBe(true);

    const publishedTsSources = [...PUBLISHED_PATHS].filter(
      (entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"),
    );
    expect(publishedTsSources).toEqual([]);
  });

  it("ships the split-bundle entry and app-bridge asset when dist exists", () => {
    const distDir = join(repoRoot, "dist");
    if (!existsSync(distDir)) {
      // Local checkouts may not have run `pnpm run build` yet.
      return;
    }

    expect(existsSync(join(distDir, "index.js"))).toBe(true);
    expect(existsSync(join(distDir, "app-bridge.bundle.js"))).toBe(true);
  });
});
