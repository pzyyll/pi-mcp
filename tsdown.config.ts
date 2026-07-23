// ABOUTME: tsdown config for split-bundle dist entry used by pi.extensions.
// ABOUTME: Inlines typebox/zod; keeps host peers, MCP SDK, open, recheck external.
import { defineConfig } from "tsdown";

/** Cold-path deps inlined so package resolve + multi-file typebox cost is tree-shaken. */
const BUNDLED_RUNTIME_DEPS = ["typebox", "zod"] as const;

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node26",
  // Prefer .js under "type": "module" so pi.extensions can load dist/index.js.
  fixedExtension: false,
  // Keep dynamic import() as separate chunks; do not flatten to one file.
  unbundle: false,
  dts: false,
  clean: true,
  sourcemap: false,
  hash: false,
  copy: ["src/app-bridge.bundle.js"],
  deps: {
    // Externalize all package deps (peers, MCP SDK, open, recheck, …).
    // Opt typebox/zod back in so cold entry avoids their multi-file resolve cost.
    neverBundle: true,
    alwaysBundle: [...BUNDLED_RUNTIME_DEPS],
    onlyBundle: [...BUNDLED_RUNTIME_DEPS],
  },
});
