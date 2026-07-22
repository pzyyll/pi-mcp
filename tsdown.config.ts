// ABOUTME: tsdown config for prebuilding the Pi MCP adapter extension to dist/.
// ABOUTME: Unbundle keeps lazy-import boundaries and import.meta.dirname asset paths intact.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./*.ts",
    "!./*.test.ts",
    "!./vitest.config.ts",
    "!./tsdown.config.ts",
  ],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  // Prefer .js under "type": "module" so pi.extensions can load dist/index.js.
  fixedExtension: false,
  unbundle: true,
  dts: false,
  clean: true,
  sourcemap: false,
  hash: false,
  copy: ["app-bridge.bundle.js"],
  deps: {
    // Keep runtime deps external; Pi/host resolves them from the installed package.
    neverBundle: true,
  },
});
