# Cold-Start Dist Bundle + Graph Slim Implementation Plan

**Goal:** Cut `pi-mcp-adapter` cold extension import time by shipping a split-bundle `dist/` entry and removing `typebox` / `zod` / eager `pi-tui` from the factory static graph, without changing MCP runtime behavior.

**Inputs:** Cold-start analysis (session 2026-07-23): warm-cache `bench:import` ≈ 295–310ms; cost dominated by `typebox` (~175–200ms), `zod` via `types.ts` re-export (~55–60ms), `@earendil-works/pi-tui` (~68ms); local multi-file overhead ≈ 7–15ms. Bundle experiment: local-only split bundle ≈ no win; inline `typebox`+`zod` ≈ **100ms**. Prior plan: `docs/plans/2026-07-23-cold-start-import-slim-plan.md` (Phase 1 lazy runtime already shipped).

**Assumptions:**

- Success metric is cold-process `pnpm run bench:import` against prebuilt `dist/index.js` (warm OS cache, fresh Node process). Report median of ≥5 runs; ignore single-digit first-run AV/disk outliers on Windows.
- Host continues to load `package.json` `pi.extensions: ["./dist/index.js"]` as native ESM (not jiti on sources).
- Pi tool `parameters` accepts plain JSON Schema objects (or TypeBox-compatible plain objects). `Type.Unsafe` / `Type.Object` are convenience, not a hard host requirement. **Validate in P2 Task 7**; if host rejects plain schemas, fall back to dynamic `import("typebox")` at registration time (still off the static import graph).
- `tsdown` remains the build tool; `deps.neverBundle` accepts an allowlist/array (`ExternalOption`), not only `true`.
- Peer packages stay external forever: `@earendil-works/pi-*`, `@modelcontextprotocol/*`, `open`, `recheck`.
- Phases ship independently: P0 alone is releasable; P1/P2 each must leave tests green and not regress P0 bench median by >10%.

**Architecture:** Publish a **single npm package** with a **split-bundle dist**: one cold entry (`dist/index.js`) plus lazy chunks for dynamic `import()` targets, while copying `app-bridge.bundle.js` beside the entry so `import.meta.dirname` asset serving keeps working. P0 gains come from tree-shaking/inlining `typebox`+`zod` into the bundle. P1 removes `zod` from the eager source graph by isolating pure tool-name helpers from stream schema re-exports. P2 removes remaining eager cost by dropping typebox from cold registration and deferring `pi-tui` seed until first sync peer use.

**Tech Stack:** TypeScript ESM, tsdown (Rolldown/esbuild-class bundling), Vitest, Node `performance.now` via `scripts/bench-import.mjs`, existing MCP SDK / typebox / zod / pi peers.

**Baselines (record on implementer’s machine before Task 1 code changes):**

| Label              | Command / condition                       | Expected ballpark (dev machine 2026-07-23)                                                                        |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Baseline B0        | current unbundle dist, median `import_ms` | ~300ms                                                                                                            |
| Goal G0 (after P0) | split bundle + inline typebox/zod         | ≤ **120ms** (stretch ≤100ms)                                                                                      |
| Goal G1 (after P1) | + zod off eager source graph              | ≤ **G0** and ≤ **B0 − 50ms** if typebox still inlined; if measuring source-graph purity only, no bench regression |
| Goal G2 (after P2) | + typebox off cold path + deferred pi-tui | ≤ **50ms** stretch; hard gate ≤ **70ms**                                                                          |

---

## File Map

- Create: `src/tool-names.ts` — pure `formatToolName` / `isToolExcluded` / `getServerPrefix` (P1); no zod, no stream schemas
- Create: `__tests__/tool-names.test.ts` — unit coverage for moved helpers (P1)
- Create: `__tests__/dist-bundle-layout.test.ts` — dist entry exists, app-bridge copied, dynamic chunks resolvable, banned packages not bare-imported from entry in a way that re-externalizes typebox/zod incorrectly (P0/P2)
- Modify: `tsdown.config.ts` — entry-only build, `unbundle: false`, selective `neverBundle`, keep `copy` of app-bridge
- Modify: `package.json` — only if scripts/files/exports need notes; keep `pi.extensions` and `files: ["dist", …]`
- Modify: `__tests__/package-manifest.test.ts` — stop requiring 1:1 `src/*.ts` → `dist/*.js`; assert entry + app-bridge + no published `.ts`
- Modify: `src/types.ts` — remove value re-exports of stream schemas (P1); re-export tool-name helpers from `tool-names.ts` for back-compat if needed
- Modify: `src/metadata-cache.ts`, `src/direct-tools-resolve.ts`, `src/tool-metadata.ts`, `src/mcp-panel.ts`, `src/proxy-modes.ts` — import tool-name helpers from `tool-names.ts` (P1)
- Modify: `src/server-manager.ts` (and any value import of stream schemas via `types.ts`) — import schemas from `ui-stream-types.ts` directly (P1)
- Modify: `src/direct-tool-register.ts` — plain JSON Schema builders; drop static `typebox` (P2)
- Modify: `src/index.ts` — remove static `seed-host-pi-tui` side-effect import (P2)
- Modify: `src/host-peers.ts` — lazy sync seed on first `getHostPiTui()` (P2)
- Modify: `src/seed-host-pi-tui.ts` — keep for tests / optional explicit seed; document non-entry use (P2)
- Modify: `src/tool-result-renderer.ts` / panel modules — only if `getHostPiTui` API changes require it (prefer no change)
- Modify: `__tests__/import-graph-eager.test.ts` — reflect P1/P2 banned/required imports
- Modify: `__tests__/setup-host-peers.ts` — still seed for unit tests that use sync TUI
- Modify: `scripts/bench-import.mjs` — optional: print median helper note only if needed; keep default target `dist/index.js`
- Modify: `CHANGELOG.md` — Performance bullets per phase
- Test: existing `__tests__/index-lifecycle.test.ts`, `direct-tool-schema.test.ts`, `direct-tools-resolve.test.ts`, `tool-result-renderer.test.ts`, `host-peers.test.ts`, `ui-server.test.ts`, `package-manifest.test.ts`, `import-graph-eager.test.ts`
- Out of scope: monorepo split, changing Pi host loader, bundling MCP SDK/recheck into entry, removing peer deps, source maps in publish, rewriting UI streaming protocol

---

## Phase map

| Phase  | Theme                                                                  | Ship gate                                                                              |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **P0** | Split-bundle dist; inline `typebox`+`zod`; peers/SDK external          | `bench:import` median ≤120ms; full test suite green; UI bridge asset served            |
| **P1** | Source-graph: isolate tool-name helpers; stop eager zod via `types.ts` | Import-graph/unit tests green; no bench regression >10% vs P0                          |
| **P2** | Remove typebox from cold registration; defer pi-tui seed               | `bench:import` median ≤70ms (stretch ≤50ms); tool register + panel + render still work |

Execute phases in order. Do not start P1 until P0 is merged or at least green on a branch. Do not start P2 until P1 green.

---

## Tasks

### Task 1: Record baseline B0

**Outcome:** Implementer has a written B0 median before any build/config change.

**Files:**

- None (notes only; optional PR description / plan checkbox)

**Steps:**

- [ ] Ensure `dist/` is current: `pnpm run build`
- [ ] Run `pnpm run bench:import` five times; record each `import_ms` and median as **B0**
- [ ] Optionally probe: `node scripts/bench-import.mjs --probe=./dist/direct-tool-register.js` and `--probe=./dist/seed-host-pi-tui.js` for later comparison
- [ ] Do not change production code in this task

**Validation:**

- Run: `pnpm run bench:import`
- Expected: exits 0; `loader=native`; `factory_type=function`; five `import_ms` values recorded

---

### Task 2 (P0): Switch tsdown to entry + split bundle with selective externals

**Outcome:** `pnpm run build` emits `dist/index.js` as the cold entry, preserves dynamic-import chunks, copies `app-bridge.bundle.js`, and inlines `typebox` + `zod` while keeping peers/SDK/open/recheck external.

**Files:**

- Modify: `tsdown.config.ts`
- Modify: `package.json` only if build script flags change (prefer config-only)

**Steps:**

- [ ] Replace config roughly as follows (adjust only if tsdown version requires equivalent keys):

  ```ts
  // ABOUTME: tsdown config for split-bundle dist entry used by pi.extensions.
  // ABOUTME: Inlines typebox/zod; keeps host peers, MCP SDK, open, recheck external.
  import { defineConfig } from "tsdown";

  export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    format: "esm",
    platform: "node",
    target: "node26",
    fixedExtension: false,
    unbundle: false,
    dts: false,
    clean: true,
    sourcemap: false,
    hash: false,
    copy: ["src/app-bridge.bundle.js"],
    deps: {
      neverBundle: [
        /^node:/,
        "@earendil-works/pi-ai",
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-tui",
        "@modelcontextprotocol/sdk",
        "@modelcontextprotocol/ext-apps",
        "open",
        "recheck",
      ],
    },
  });
  ```

- [ ] Confirm **not** listing `typebox` or `zod` in `neverBundle` (they must be bundled/tree-shaken into entry or shared chunks).
- [ ] Keep dynamic `import("./…")` call sites in source unchanged so Rolldown/tsdown emits separate lazy chunks.
- [ ] Run `pnpm run build` and inspect `dist/`:
  - `index.js` exists
  - `app-bridge.bundle.js` exists at `dist/app-bridge.bundle.js` (not only nested)
  - Additional chunk files exist for lazy paths (names may be hashed)
  - Entry must not bare-import `typebox` or `zod` as external package specifiers (grep `from "typebox"` / `from "zod"` in `dist/index.js` and its **statically** imported local chunks only)
- [ ] If tsdown fails to copy app-bridge next to entry, add an explicit post-build copy in `package.json` `build` script: `tsdown && node -e "fs.cpSync('src/app-bridge.bundle.js','dist/app-bridge.bundle.js')"` with `fs` import — only if needed.

**Validation:**

- Run: `pnpm run build`
- Expected: exit 0; `dist/index.js` and `dist/app-bridge.bundle.js` exist
- Run: `pnpm run bench:import` ×5
- Expected: median `import_ms` ≤ **120ms** and ≤ **0.5 × B0** (hard); stretch ≤100ms
- Run: `rg -n "from [\"']typebox[\"']|from [\"']zod[\"']" dist/index.js`
- Expected: no matches on the entry file (inlined or unused). If a static local chunk still externalizes them, fix `neverBundle` / mark them bundleable.

---

### Task 3 (P0): Fix publish/layout tests for bundled dist

**Outcome:** Manifest and layout tests match split-bundle reality; no requirement that every `src/*.ts` appears as `dist/<same>.js`.

**Files:**

- Modify: `__tests__/package-manifest.test.ts`
- Create: `__tests__/dist-bundle-layout.test.ts`

**Steps:**

- [ ] In `package-manifest.test.ts`, replace the “every src runtime module → dist js” assertion with:
  - `dist/index.js` exists after build (skip gracefully only if dist missing, same as today)
  - `dist/app-bridge.bundle.js` exists
  - `package.json` `pi.extensions === ["./dist/index.js"]`
  - published `files` still includes `dist`, not raw `.ts`
- [ ] Add `dist-bundle-layout.test.ts` that, when `dist/` exists:
  - Parses `dist/index.js` static import specifiers (same style as `import-graph-eager.test.ts`)
  - Asserts none of: `recheck`, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `@earendil-works/pi-ai` appear as static imports on the entry (pi-tui may still appear until P2)
  - Asserts `app-bridge.bundle.js` is readable next to entry
  - Optionally: `await import(pathToFileURL(dist/index.js))` default export is a function (smoke; can reuse bench script logic)
- [ ] Do not assert exact chunk filenames (hashes may change).

**Validation:**

- Run: `pnpm exec vitest run __tests__/package-manifest.test.ts __tests__/dist-bundle-layout.test.ts`
- Expected: pass after `pnpm run build`

---

### Task 4 (P0): Regression suite + changelog for bundle publish

**Outcome:** Full suite green on bundled dist; Unreleased changelog notes P0.

**Files:**

- Modify: `CHANGELOG.md`
- Touch only if failures force small source fixes (prefer config/test-only)

**Steps:**

- [ ] Run full `pnpm test`
- [ ] Fix fallout limited to:
  - tests assuming 1:1 dist file names
  - path issues for `app-bridge.bundle.js` via `import.meta.dirname`
  - dynamic import path resolution under splitting
- [ ] Do **not** start P1 graph edits in this task
- [ ] CHANGELOG under `## [Unreleased]` → `### Performance`:
  - “Ship split-bundle `dist/` entry that inlines `typebox`/`zod` while keeping host peers and MCP SDK external, cutting cold extension import time.”
- [ ] Record median `import_ms` as **R0** next to B0 in PR notes

**Validation:**

- Run: `pnpm test`
- Expected: all pass
- Run: `pnpm run bench:import` ×5
- Expected: median ≤120ms (**R0**); `factory_type=function`
- Run: `pnpm exec vitest run __tests__/ui-server.test.ts -t "app-bridge"`
- Expected: pass (bundle asset route still works)

---

### Task 5 (P1): Extract pure tool-name helpers off `types.ts`

**Outcome:** Cold path modules can use `formatToolName` / `isToolExcluded` / `getServerPrefix` without loading `ui-stream-types` → `zod`.

**Files:**

- Create: `src/tool-names.ts`
- Create: `__tests__/tool-names.test.ts`
- Modify: `src/types.ts`
- Modify: `src/metadata-cache.ts`
- Modify: `src/direct-tools-resolve.ts`
- Modify: `src/tool-metadata.ts`
- Modify: `src/mcp-panel.ts`
- Modify: `src/proxy-modes.ts` (if it imports `getServerPrefix` from `types.ts`)
- Modify: any other **value** importers of those three functions (grep before edit)

**Steps:**

- [ ] Move implementations of `getServerPrefix`, `formatToolName`, `isToolExcluded` (and any private helpers they need) from `types.ts` into `tool-names.ts` with ABOUTME header
- [ ] Keep `types.ts` re-exporting them for back-compat **only if** that re-export does not reintroduce a runtime import cycle into zod; prefer:

  ```ts
  export { formatToolName, isToolExcluded, getServerPrefix } from "./tool-names.ts";
  ```

  and ensure `tool-names.ts` has **zero** imports from `ui-stream-types.ts` / `zod`

- [ ] Point cold-path call sites at `./tool-names.ts` directly: at least `metadata-cache.ts`, `direct-tools-resolve.ts`, `tool-metadata.ts`, `mcp-panel.ts`
- [ ] Add unit tests porting the behavioral expectations currently implicit in metadata/direct-tools-resolve tests (prefix modes `server` | `none` | `short`; exclude list matching with `-`/`_` normalization)
- [ ] Grep: `formatToolName|isToolExcluded|getServerPrefix` under `src/` — every production value import should be from `tool-names.ts` or the thin re-export

**Validation:**

- Run: `pnpm exec vitest run __tests__/tool-names.test.ts __tests__/direct-tools-resolve.test.ts __tests__/tool-metadata.test.ts __tests__/mcp-panel-exclude-tools.test.ts`
- Expected: pass
- Run: `pnpm run build && node scripts/bench-import.mjs` ×3
- Expected: median within 10% of **R0** (P1 may not drop much if typebox still inlined dominates)

---

### Task 6 (P1): Stop value re-exporting stream schemas from `types.ts`

**Outcome:** Importing `types.ts` for MCP domain types no longer evaluates `zod` schemas; stream schemas are imported only from `ui-stream-types.ts`.

**Files:**

- Modify: `src/types.ts` — delete the value re-export block of stream schemas/constants/helpers (keep `import type { UiStreamMode }` only)
- Modify: `src/server-manager.ts` — import `serverStreamResultPatchNotificationSchema` from `./ui-stream-types.ts`
- Modify: any other file that imported stream **values** from `./types.ts` (grep `uiStream|visualizationStream|UI_STREAM_|SERVER_STREAM_|getUiStreamHostContext|getVisualizationStreamEnvelope`)
- Modify: `examples/interactive-visualizer/**` only if it imported stream schemas via `types.ts` (current tree already uses `ui-stream-types.ts` — verify, do not break)
- Modify: `__tests__/import-graph-eager.test.ts` — add assertion that `metadata-cache.ts` and `direct-tools-resolve.ts` static imports do not include `zod` or `ui-stream-types.ts`

**Steps:**

- [ ] Remove from `types.ts` the block that re-exports stream schemas (approx. the “Re-export stream types from the shared lightweight module” section)
- [ ] Update production imports to `./ui-stream-types.ts` for runtime schema usage
- [ ] Keep type-only imports of `UiStreamMode` etc. either from `ui-stream-types.ts` or via `import type` in `types.ts` without value imports
- [ ] Rebuild; confirm eager dist graph for entry no longer needs a large zod chunk **if** typebox-only remains (zod should drop from static entry graph once no cold module imports it)
- [ ] Extend import-graph test:

  ```ts
  // metadata-cache + direct-tools-resolve must not static-import zod or ui-stream-types
  ```

**Validation:**

- Run: `pnpm exec vitest run __tests__/import-graph-eager.test.ts __tests__/ui-streaming.test.ts __tests__/server-manager-sampling.test.ts`
- Expected: pass
- Run: `pnpm run build`
- Expected: exit 0
- Run: static check — `node` script or `rg` that `dist` modules statically reachable from `index.js` do not `from "zod"` (optional but recommended in `dist-bundle-layout.test.ts`)
- Run: `pnpm run bench:import` ×5
- Expected: median ≤ **R0**; if zod fully leaves eager graph, expect a visible drop vs a pure-external typebox build — with inlined typebox still present, drop may be modest; record **R1**

---

### Task 7 (P2): Remove typebox from cold tool registration

**Outcome:** Factory registers proxy/direct tools without loading `typebox`; parameters are plain JSON Schema objects (or dynamic typebox only if host requires it).

**Files:**

- Modify: `src/direct-tool-register.ts`
- Modify: `__tests__/import-graph-eager.test.ts`
- Modify: `__tests__/index-lifecycle.test.ts` only if mocks assume TypeBox shapes
- Test: `__tests__/direct-tool-schema.test.ts` (extend if builders move)

**Steps:**

- [ ] Change `buildProxyToolParameters()` to return a plain JSON Schema object equivalent to the current `Type.Object({…})` shape (same property names/descriptions/optionality)
- [ ] Change `buildDirectToolParameters(inputSchema)` to return `normalizeDirectToolInputSchema(inputSchema)` **without** `Type.Unsafe`, unless Task 7 validation shows host rejection
- [ ] Remove `import { Type } from "typebox"` from `direct-tool-register.ts`
- [ ] Update `import-graph-eager.test.ts`:
  - `direct-tool-register.ts` must **not** static-import `typebox`
  - keep bans on sdk/recheck/pi-ai for resolve/register modules
- [ ] If integration with `@earendil-works/pi-coding-agent` rejects plain schemas:
  - Fall back: `const { Type } = await import("typebox")` is **not** available inside sync `registerTool` — use sync `createRequire` only as last resort, or prebuild the proxy schema as a `as const` object (preferred)
  - Document the fallback in the PR; do not reintroduce static `import "typebox"` on the factory graph
- [ ] Ensure `typebox` can remain a dependency (other code may still use it later) but it must not appear on the eager entry graph; after rebuild, entry static graph should not load typebox code paths for registration

**Validation:**

- Run: `pnpm exec vitest run __tests__/import-graph-eager.test.ts __tests__/direct-tool-schema.test.ts __tests__/index-lifecycle.test.ts __tests__/direct-tools-resolve.test.ts`
- Expected: pass
- Run: `pnpm run build && pnpm run bench:import` ×5
- Expected: median materially below **R1** if typebox was still being parsed; record interim number
- Manual/host smoke (if pi available): start pi with this extension; confirm proxy tool and one direct tool register without parameter errors

---

### Task 8 (P2): Defer `pi-tui` seed off the module import graph

**Outcome:** Loading `dist/index.js` no longer statically imports `@earendil-works/pi-tui`; first sync TUI use seeds peers lazily; panels/commands keep working.

**Files:**

- Modify: `src/index.ts` — remove `import "./seed-host-pi-tui.ts"`
- Modify: `src/host-peers.ts` — lazy seed inside `getHostPiTui()` when missing
- Modify: `src/seed-host-pi-tui.ts` — keep for Vitest setup / explicit seed; ABOUTME notes it is not required on the published entry
- Modify: `__tests__/import-graph-eager.test.ts` — stop requiring `./seed-host-pi-tui.ts` on index; assert index does **not** static-import `@earendil-works/pi-tui` or `./seed-host-pi-tui.ts`
- Modify: `__tests__/setup-host-peers.ts` — unchanged seed for tests that need deterministic peers
- Modify: `__tests__/host-peers.test.ts` / `tool-result-renderer.test.ts` if they relied on entry-level seed without setup file

**Steps:**

- [ ] Implement lazy init in `getHostPiTui()`:
  - If store already has peers → return
  - Else synchronously resolve host `pi-tui` the same way `ensureHostPiTui` does filesystem/bare import, but **sync**:
    - Prefer extracting shared resolution helpers from the async path
    - Use `createRequire(import.meta.url).resolve` / existing `findHostPackageDir` + `createRequire(…).require(entryPath)` **or** keep async-only resolve and document that sync path uses `createRequire` on package entry
  - Seed store; then return
- [ ] Keep `ensureHostPiTui()` as the async API used by commands before panels; it should short-circuit if sync seed already filled the store
- [ ] Remove entry side-effect import from `index.ts`
- [ ] Confirm panel modules still only use `getHostPiTui()` (no bare `pi-tui` import) — already true
- [ ] Confirm `tool-result-renderer.ts` still works: first `render*` calls `getHostPiTui()` → lazy seed
- [ ] Do not bundle `pi-tui` into dist (must stay external peer)

**Validation:**

- Run: `pnpm exec vitest run __tests__/import-graph-eager.test.ts __tests__/host-peers.test.ts __tests__/tool-result-renderer.test.ts __tests__/mcp-panel-keybindings.test.ts __tests__/mcp-panel-rendering.test.ts __tests__/index-lifecycle.test.ts`
- Expected: pass
- Run: `pnpm run build`
- Expected: `rg -n "@earendil-works/pi-tui" dist/index.js` shows **no** static import of pi-tui on the cold entry (lazy chunk or runtime resolve inside host-peers chunk is OK if that chunk is only pulled when getHostPiTui runs — prefer host-peers on entry but resolve package only inside function body)
- Important: static `import "…pi-tui"` at top of any module statically reachable from `index.js` is a failure; dynamic `import()` or `createRequire` inside `getHostPiTui` is success
- Run: `pnpm run bench:import` ×5
- Expected: median ≤ **70ms** hard gate (**R2**); stretch ≤50ms vs B0 ~300ms

---

### Task 9 (P2): Full regression, dist guards, changelog

**Outcome:** Suite green; dist layout guards encode P0–P2 invariants; changelog complete; final numbers recorded.

**Files:**

- Modify: `__tests__/dist-bundle-layout.test.ts` — entry static imports ban `typebox`, `zod`, `@earendil-works/pi-tui`, `recheck`, MCP sdk
- Modify: `CHANGELOG.md`
- Modify: plan checkboxes / PR body with B0, R0, R1, R2

**Steps:**

- [ ] Strengthen dist layout test for final bans on entry static graph
- [ ] Run full `pnpm test`
- [ ] Run `pnpm run build && pnpm run bench:import` ×5 → **R2**
- [ ] CHANGELOG Performance bullets for P1/P2 (or one combined bullet if single release):
  - Isolate tool-name helpers so cache/resolve paths do not load zod stream schemas
  - Register tools with plain JSON Schema (no typebox on cold path)
  - Defer host pi-tui seeding until first TUI use
- [ ] Smoke: `pnpm exec vitest run __tests__/ui-server.test.ts` still serves app-bridge

**Validation:**

- Run: `pnpm test`
- Expected: all pass
- Run: `pnpm run bench:import` ×5
- Expected: median ≤70ms; factory default export function
- Run: `pnpm exec vitest run __tests__/import-graph-eager.test.ts __tests__/dist-bundle-layout.test.ts __tests__/package-manifest.test.ts`
- Expected: pass

---

## Final Validation

- Run: `pnpm run build`
- Expected: exit 0; `dist/index.js` + `dist/app-bridge.bundle.js` present
- Run: `pnpm test`
- Expected: full suite pass
- Run: `pnpm run bench:import` (5×)
- Expected: median ≤70ms after P2; ≤120ms if only P0 ships
- Run: `pnpm exec vitest run __tests__/import-graph-eager.test.ts __tests__/dist-bundle-layout.test.ts`
- Expected: pass
- Optional host: launch `pi` with only this extension; startup log shows lower extension import time; `/mcp` status + one tool call + one panel open succeed

## Failure Behavior

- **Build emits no app-bridge file** — fail Task 2/3; do not publish; restore copy step
- **Dynamic import chunk missing at runtime** — tool/command path throws module-not-found; fix split config / keep relative dynamic imports in source; covered by lifecycle and command tests
- **Plain JSON Schema rejected by host** — Task 7 fallback: keep plain object shape compatible with TypeBox JSON Schema encoding, or construct with a tiny local schema literal; do not re-static-import typebox on entry
- **Lazy pi-tui resolve fails** — `getHostPiTui()` throws clear error (existing message style); commands that `await ensureHostPiTui()` surface the same failure before panel open
- **Bench regression >10% vs previous phase median** — treat phase as failed; do not merge

## Privacy and Security

- No auth/token handling changes
- Do not bundle or rewrite OAuth/token paths in P0–P2
- Inlining `typebox`/`zod` into dist only ships already-licensed dependency code already declared in package metadata; no new network trust surface

## Rollout Notes

- Single package version bump when releasing (likely minor if advertised performance; patch if quiet)
- Consumers already on `pi.extensions: dist/index.js` need only upgrade the package — no config migration
- Downstream that imported deep `dist/<module>.js` paths (if any) may break under hashed chunks — **unsupported**; public surface is package root + `pi.extensions` entry only
- Publish with `pnpm run prepublishOnly` → build

## Risks and Mitigations

| Risk                                                                           | Mitigation                                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsdown split places typebox/zod in a static shared chunk still loaded by entry | Acceptable if inlined; verify no external package resolve; bench is source of truth                                                                |
| `import.meta.dirname` points at chunk dir not dist root for app-bridge         | Keep ui-server asset path tested; force copy to `dist/` root; if chunk moves, resolve via `join(distRoot, "app-bridge.bundle.js")` using entry URL |
| Lazy sync `require` of pi-tui fails under pure ESM host layouts                | Reuse existing `findHostPackageDir` + `pathToFileURL` patterns; dual-path with `ensureHostPiTui` already proven in commands                        |
| Host requires TypeBox `Kind` brand on parameters                               | Task 7 validation + fallback schema encoding                                                                                                       |
| Windows AV skews bench                                                         | Median of 5; compare relative to B0 on same machine                                                                                                |
| package-manifest 1:1 assumption blocks CI                                      | Task 3 updates tests before merge                                                                                                                  |

## Open Questions

- None blocking P0. For P2 Task 7, confirm on a real `pi` session that plain JSON Schema `parameters` are accepted by the installed `@earendil-works/pi-coding-agent` (assumed yes; fallback documented in Task 7).

---

## Execution checklist (quick)

- [ ] P0 Task 1 — B0
- [ ] P0 Task 2 — tsdown split bundle + inline typebox/zod
- [ ] P0 Task 3 — manifest/layout tests
- [ ] P0 Task 4 — full test + changelog → **R0 ≤120ms**
- [ ] P1 Task 5 — `tool-names.ts`
- [ ] P1 Task 6 — drop stream re-exports / zod off cold graph → **R1**
- [ ] P2 Task 7 — plain JSON Schema registration
- [ ] P2 Task 8 — defer pi-tui seed
- [ ] P2 Task 9 — final suite + **R2 ≤70ms**
