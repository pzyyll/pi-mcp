// ABOUTME: Vitest config for adapter unit and integration tests.
// ABOUTME: Covers __tests__ only; root package scripts cover node:test OAuth suites.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "__tests__/**", "vitest.config.ts", "cli.js"],
    },
  },
});
