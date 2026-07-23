# Cold-Start Import Slim Implementation Plan

**Goal:** Cut `pi-mcp-adapter` cold `module import` time by shrinking the eager static dependency graph, without changing MCP runtime behavior.

**Inputs:** Cold-start timing analysis (startup log: adapter module import ~8442ms / factory ~4ms); package source under `F:/workspace/source/pi-mcp-adapter`.

**Assumptions:**

- Host continues loading extensions via jiti from TypeScript sources (`pi.extensions: ["./index.ts"]`). Prebuilt `dist/` is a follow-up phase, not required for the first shippable win.
- Success metric is **adapter module-import wall time** under a fixed micro-benchmark (same machine, warm OS cache + cold process). Target: **≥50% reduction** vs pre-change baseline on the same harness; stretch **≥70%** after all Phase 1 tasks.
- Functional behavior of tools, OAuth, UI, sampling, elicitation, and search safety remains unchanged; only _when_ modules load may change.
- Windows cold-disk/AV variance is large; report both harness numbers and optional full `pi` startup log, but gate CI on harness + unit tests.

**Architecture:** Keep a thin factory path that only loads config/cache resolution and registers tools/commands/handlers. Move heavy runtime (MCP SDK client stack, OAuth, UI server, sampling/elicitation, `recheck`, `typebox`, `pi-ai`, large command/proxy modules) behind `await import()` on first use. Prefer extracting light pure helpers over rewriting features. Existing panel lazy-loads (`mcp-panel.ts`, `mcp-setup-panel.ts`) stay as the pattern to copy.

**Tech Stack:** TypeScript ESM sources, jiti (host), vitest, Node `performance.now` micro-benchmark, existing MCP SDK / typebox / recheck deps (no new runtime deps).

---

## File Map

- Create: `scripts/bench-import.mjs` — cold-process jiti import timer for `index.ts` (+ optional subgraph probes)
- Create: `direct-tools-resolve.ts` — pure direct-tool resolution helpers with no `init` / auth / UI / MCP SDK imports
- Create: `schema-format.ts` — `formatSchema` (and any pure schema helpers) extracted from `tool-metadata.ts`
- Create: `__tests__/direct-tools-resolve.test.ts` — coverage for extracted resolve helpers
- Create: `__tests__/import-graph-eager.test.ts` — static scan asserting banned top-level imports on the factory path
- Modify: `index.ts` — thin factory; dynamic import heavy modules inside handlers / registration paths
- Modify: `direct-tools.ts` — keep executors only; re-export resolve from light module for back-compat
- Modify: `proxy-modes.ts` — dynamic `recheck`; avoid pulling UI/auth until call paths need them where practical
- Modify: `server-manager.ts` — dynamic import sampling/elicitation registrars at connect time
- Modify: `ui-session.ts` — dynamic import `ui-server` when starting a UI session
- Modify: `tool-metadata.ts` — import `formatSchema` from `schema-format.ts`; keep UI URI helpers here
- Modify: `tool-result-renderer.ts` — lazy-load `@earendil-works/pi-tui` inside render functions if still on eager path
- Modify: `metadata-cache.ts` — optional: defer `getToolUiResourceUri` usage behind local dynamic import or pure URI helper if cheap to inline
- Modify: `commands.ts` — dynamic import `mcp-auth-flow` / heavy helpers inside command actions (not module top-level) where it breaks the eager graph
- Modify: `package.json` — add `bench:import` script; add any new published files to `files[]`
- Modify: `CHANGELOG.md` — Unreleased performance note
- Test: existing `__tests__/index-lifecycle.test.ts`, `direct-tools*.test.ts`, `proxy-modes*.test.ts`, `server-manager-*.test.ts`, `sampling-handler.test.ts`, `elicitation-*.test.ts`, `ui-*.test.ts`, `package-manifest.test.ts` — must still pass
- Out of scope (Phase 2 note only): precompiled `dist/`, changing host extension loader, parallel extension loading in pi

---

## Tasks

### Task 1: Baseline import benchmark

**Outcome:** A reproducible command reports `index.ts` jiti import ms and a short breakdown; baseline number is recorded in the plan/PR description.

**Files:**

- Create: `scripts/bench-import.mjs`
- Modify: `package.json`

**Steps:**

- [ ] Add `scripts/bench-import.mjs` that:
  - Resolves package root from `import.meta.url`
  - Creates jiti with `{ moduleCache: false, interopDefault: true }` (closest practical match to pi’s loader in Node)
  - Times `await jiti.import(join(root, "index.ts"), { default: true })`
  - Prints `import_ms=<n>` and `factory_type=<typeof default export>`
  - Supports optional `--probe=<module>` to time a single relative module the same way
- [ ] Add npm script: `"bench:import": "node scripts/bench-import.mjs"`
- [ ] Run once on a quiet machine; capture baseline `import_ms` (warm OS cache, fresh process). Record as **Baseline A**.
- [ ] Do **not** change production code in this task.

**Validation:**

- Run: `npm run bench:import`
- Expected: exits 0; prints `import_ms=` with a positive number; default export is a function

---

### Task 2: Split light direct-tool resolution off the heavy executor module

**Outcome:** Factory can resolve direct tool specs without importing `init.ts` → `server-manager.ts` → MCP SDK / sampling / elicitation / OAuth.

**Files:**

- Create: `direct-tools-resolve.ts`
- Create: `schema-format.ts`
- Modify: `direct-tools.ts`
- Modify: `tool-metadata.ts`
- Modify: `index.ts` (import resolve from light module)
- Modify: `package.json` (`files[]` includes new modules)
- Test: `__tests__/direct-tools-resolve.test.ts`
- Test: existing `direct-tools.test.ts` / `direct-tool-schema.test.ts` (adjust imports only if needed)

**Steps:**

- [ ] Move pure `formatSchema` implementation from `tool-metadata.ts` into `schema-format.ts` (no `@modelcontextprotocol/*` imports).
- [ ] Re-export `formatSchema` from `tool-metadata.ts` for back-compat.
- [ ] Create `direct-tools-resolve.ts` containing:
  - `resolveDirectTools`
  - `getMissingConfiguredDirectToolServers`
  - `buildProxyDescription` (if it only needs config/cache/types; otherwise leave it and document)
  - Allowed imports: `types.ts`, `metadata-cache.ts` (type + pure helpers), `schema-format.ts`, `resource-tools.ts`, `utils.ts`, Node builtins
  - **Banned** top-level imports: `init.ts`, `server-manager.ts`, `mcp-auth-flow.ts`, `ui-session.ts`, `proxy-modes.ts`, `@modelcontextprotocol/sdk/*`, `recheck`, `typebox`, `@earendil-works/pi-ai`
- [ ] Keep `createDirectToolExecutor` (and auto-auth helpers) in `direct-tools.ts`; re-export resolve helpers from `direct-tools.ts` so existing `from "./direct-tools.ts"` call sites keep working.
- [ ] Point `index.ts` factory resolution at `./direct-tools-resolve.ts` (or keep re-export if graph is already clean).
- [ ] Add unit tests for resolve behavior already covered elsewhere only if extraction risks divergence; minimal smoke tests for exported function presence + one fixture cache → specs mapping.
- [ ] Update `package.json` `files` for new `.ts` modules (`package-manifest.test.ts` enforces this).

**Validation:**

- Run: `npx vitest run __tests__/direct-tools-resolve.test.ts __tests__/direct-tools.test.ts __tests__/direct-tool-schema.test.ts __tests__/package-manifest.test.ts`
- Expected: all pass
- Run: `npm run bench:import`
- Expected: `import_ms` ≤ Baseline A (may still be high; no regression)

---

### Task 3: Lazy-load `recheck` on regex search only

**Outcome:** `recheck` (≈2.8MB JS) is not loaded during module import; search `regex:true` still rejects unsafe patterns.

**Files:**

- Modify: `proxy-modes.ts`
- Test: existing proxy-modes tests covering search (add targeted case if none asserts unsafe regex)

**Steps:**

- [ ] Remove top-level `import { checkSync } from "recheck"`.
- [ ] Inside `executeSearch` regex branch only:
  - `const { checkSync } = await import("recheck");`
  - Keep existing `REGEX_SAFETY_CHECK_PARAMS`, length limit, and status handling unchanged.
- [ ] Non-regex search path must not import `recheck`.

**Validation:**

- Run: `npx vitest run __tests__/proxy-modes-discovery.test.ts`
- Expected: pass (add/adjust test if needed for unsafe regex rejection)
- Run: `node scripts/bench-import.mjs --probe=./proxy-modes.ts` before/after if useful
- Expected: post-change probe no longer requires loading `recheck` until search executes

---

### Task 4: Defer sampling + elicitation registration modules until connect

**Outcome:** `server-manager.ts` no longer statically imports `sampling-handler.ts` / `elicitation-handler.ts` (and thus `pi-ai` / ajv / `open` via those modules) at import time.

**Files:**

- Modify: `server-manager.ts`
- Test: `__tests__/server-manager-sampling.test.ts`, `__tests__/elicitation-handler.test.ts`, `__tests__/init-elicitation.test.ts`

**Steps:**

- [ ] Replace static imports of `registerSamplingHandler` / `registerElicitationHandler` with dynamic `await import("./sampling-handler.ts")` / `await import("./elicitation-handler.ts")` at the connect-time registration site(s) (~lines that currently call them after client connect).
- [ ] Keep `ServerSamplingConfig` typing via `import type` only (erased at runtime).
- [ ] Preserve call order, arguments, and error propagation.

**Validation:**

- Run: `npx vitest run __tests__/server-manager-sampling.test.ts __tests__/init-elicitation.test.ts __tests__/elicitation-handler.test.ts __tests__/sampling-handler.test.ts`
- Expected: all pass

---

### Task 5: Defer UI server stack until a UI session starts

**Outcome:** Importing tool execution paths does not load `ui-server.ts` / host HTML template / app-bridge server helpers until `maybeStartUiSession` actually starts a session.

**Files:**

- Modify: `ui-session.ts`
- Test: `__tests__/ui-session-messages.test.ts`, `__tests__/ui-server.test.ts`, `__tests__/ui-integration.test.ts`

**Steps:**

- [ ] Remove static `import { startUiServer, type UiServerHandle } from "./ui-server.ts"`.
- [ ] Use `import type { UiServerHandle } from "./ui-server.ts"` for types.
- [ ] Dynamically import `./ui-server.ts` inside the function that first needs `startUiServer`.
- [ ] Keep session ID / message / close behavior identical.

**Validation:**

- Run: `npx vitest run __tests__/ui-session-messages.test.ts __tests__/ui-server.test.ts __tests__/ui-integration.test.ts __tests__/ui-streaming.test.ts`
- Expected: all pass

---

### Task 6: Thin `index.ts` factory — dynamic import runtime modules in handlers

**Outcome:** Loading `index.ts` no longer eagerly evaluates `proxy-modes.ts`, `init.ts`, `commands.ts`, `mcp-auth-flow.ts`, or heavy `direct-tools` executor graph just to register the extension.

**Files:**

- Modify: `index.ts`
- Modify: `commands.ts` (only if still pulled transitively with heavy static imports)
- Modify: `tool-result-renderer.ts` (lazy `pi-tui` if still required at factory)
- Test: `__tests__/index-lifecycle.test.ts`
- Test: `__tests__/import-graph-eager.test.ts`

**Steps:**

- [ ] **Keep synchronous factory needs only:**
  - `loadMcpConfig` / `loadMetadataCache` / `getConfigPathFromArgv`
  - light resolve helpers from Task 2
  - `registerTool` / `registerCommand` / `registerFlag` / `pi.on(...)` wiring
- [ ] **Direct tools registration:**
  - Dynamic `await import("typebox")` only when `directSpecs.length > 0` **before** the registration loop, **or** register tools via a small helper that imports typebox once.
  - Note: factory is currently sync (`export default function`). Prefer keeping it sync by:
    - either using a sync registration that does not need typebox when there are zero direct tools (common case), and for non-zero specs use `Type` from a deferred path only if pi allows async factory (it does not today — factory is sync), **or**
    - keep a **conditional static import alternative**: extract `registerDirectTools(pi, specs, getters)` in a separate module imported only via a sync path that still avoids MCP SDK — typebox may remain on the direct-tool registration path when specs exist.
  - **Decision (locked):** keep factory **sync**. When `directSpecs.length === 0`, do not import `typebox`. When `directSpecs.length > 0`, import typebox through a tiny `direct-tool-register.ts` module that depends on `typebox` + light resolve only (no MCP SDK). Document that users with many direct tools still pay typebox cost at factory (acceptable).
- [ ] **Proxy tool `execute` / command handlers / session hooks:**
  - Use lazy module getters, e.g. `const mod = await import("./proxy-modes.ts")` inside execute/action bodies.
  - `session_start` / `session_shutdown`: `await import("./init.ts")`, `await import("./mcp-auth-flow.ts")` inside the handlers.
  - Slash commands: dynamic import `./commands.ts` inside the command callback.
- [ ] **Renderers:** keep function references registered at factory time, but implement them as thin wrappers:
  - `renderCall: (args, theme) => { const { renderMcpProxyToolCall } = requireOrCachedRenderer(); return renderMcpProxyToolCall(args, theme); }`
  - Prefer a small memoized `async` is **not** available for sync TUI render — so renderer module may need to stay sync-imported **or** `tool-result-renderer.ts` must stay light (only `pi-tui` Text/Box).
  - **Decision (locked):** keep `tool-result-renderer.ts` sync-imported; ensure it only imports `@earendil-works/pi-tui` UI primitives and local types — no MCP SDK. If `pi-tui` cost remains material, accept it for correct sync rendering.
- [ ] Update `__tests__/index-lifecycle.test.ts` mocks if import paths become dynamic (vi.mock still applies to module graph when dynamically imported in vitest; verify and adjust to `vi.mocked` dynamic paths if needed).
- [ ] Add `__tests__/import-graph-eager.test.ts`:
  - Parse `index.ts` top-level import specifiers (static only).
  - Assert banned list not present: `recheck`, `@modelcontextprotocol/sdk`, `./server-manager.ts`, `./sampling-handler.ts`, `./elicitation-handler.ts`, `./ui-server.ts`, `./proxy-modes.ts`, `./init.ts`, `./mcp-auth-flow.ts`, `./commands.ts` (adjust if a banned module must remain — then ban its heavy children instead).
  - This is a guardrail test, not a full graph solver.

**Validation:**

- Run: `npx vitest run __tests__/index-lifecycle.test.ts __tests__/import-graph-eager.test.ts`
- Expected: pass
- Run: `npm run bench:import`
- Expected: `import_ms` ≤ **50% of Baseline A** after Tasks 2–6 (record as **Result B**)

---

### Task 7: Break remaining heavy edges on first-call paths

**Outcome:** First tool call still works; auth/UI/connect paths dynamic-import their stacks; no accidental reintroduction of static SDK imports on the factory graph.

**Files:**

- Modify: `direct-tools.ts` (executor-only; already heavy — OK if only loaded from execute path)
- Modify: `proxy-modes.ts`
- Modify: `commands.ts`
- Modify: `init.ts` only if it statically imports avoidable UI-only modules
- Test: `__tests__/direct-tools-auto-auth.test.ts`, `__tests__/proxy-modes-auto-auth.test.ts`, `__tests__/proxy-modes-manual-auth.test.ts`, `__tests__/commands-auth.test.ts`, `__tests__/server-manager-http-auth.test.ts`

**Steps:**

- [ ] Ensure `createDirectToolExecutor` lives in a module only loaded when:
  - registering direct tools (needs the executor function reference), **or**
  - first execute (preferred if registration can bind a trampoline: `execute: async (...args) => (await import("./direct-tools.ts")).createDirectToolExecutor(...)(...args)` with memoization of the created executor per spec).
- [ ] **Decision (locked):** use a **memoized trampoline** per `DirectToolSpec` so `direct-tools.ts` (SDK/auth/UI) is not loaded at factory when direct tools are registered; only light resolve + register module load at factory.
- [ ] Same trampoline pattern for proxy tool modes: factory registers one proxy tool whose `execute` dynamic-imports `proxy-modes.ts`.
- [ ] In `commands.ts`, dynamic-import `./mcp-auth-flow.ts` inside auth-related actions if still static.
- [ ] Grep guard: after changes, `rg -n "from \"@modelcontextprotocol/sdk|from \"recheck|from \"typebox|from \"@earendil-works/pi-ai" index.ts direct-tools-resolve.ts schema-format.ts` returns empty (typebox allowed only in `direct-tool-register.ts`).

**Validation:**

- Run: `npx vitest run __tests__/direct-tools-auto-auth.test.ts __tests__/proxy-modes-auto-auth.test.ts __tests__/proxy-modes-manual-auth.test.ts __tests__/commands-auth.test.ts __tests__/server-manager-http-auth.test.ts`
- Expected: all pass
- Run: `npm run bench:import`
- Expected: `import_ms` improved vs Result B or flat; no regression >10%

---

### Task 8: Optional cache/app-bridge trim on eager path

**Outcome:** If Task 6–7 still show `@modelcontextprotocol/ext-apps/app-bridge` on the factory graph via `metadata-cache.ts`, remove or defer it.

**Files:**

- Modify: `metadata-cache.ts` and/or `tool-metadata.ts`
- Test: `__tests__/tool-metadata.test.ts` and any cache tests

**Steps:**

- [ ] Profile with `node scripts/bench-import.mjs` after Task 7.
- [ ] If `metadata-cache.ts` is still eager (needed for direct tool resolve) and `getToolUiResourceUri` is costly:
  - Inline the minimal URI construction used at cache-read time, **or**
  - Dynamic-import app-bridge only when writing/reading UI resource fields that need it.
- [ ] Do not change on-disk cache schema.

**Validation:**

- Run: `npx vitest run __tests__/tool-metadata.test.ts`
- Expected: pass
- Run: `npm run bench:import`
- Expected: stable or better vs Task 7

---

### Task 9: Full regression + changelog

**Outcome:** Full test suite green; Unreleased changelog entry documents performance-only change.

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `package.json` if scripts/files still incomplete

**Steps:**

- [ ] Run full `npm test`.
- [ ] Fix any fallout from dynamic import / mock ordering.
- [ ] Add CHANGELOG under `## [Unreleased]` → `### Changed` (or `### Performance`):
  - One bullet: deferred heavy MCP runtime imports to first use to reduce Pi cold-start extension load time.
- [ ] Record final `npm run bench:import` as **Result C** in PR/commit notes (not necessarily in CHANGELOG numbers, to avoid machine-specific claims).

**Validation:**

- Run: `npm test`
- Expected: all tests pass
- Run: `npm run bench:import`
- Expected: `import_ms` ≤ **50% of Baseline A** (hard goal); note if stretch ≥70% met

---

### Task 10 (Phase 2 / separate PR): Precompiled dist entry — optional

**Outcome:** Documented follow-up only; not required to close Phase 1.

**Files (future):**

- Create: build script / `tsconfig.build.json`
- Modify: `package.json` `pi.extensions`, `files`, `exports`
- Modify: all relative imports (`.ts` → `.js`) or use a bundler
- Modify: `__tests__/package-manifest.test.ts`

**Steps:**

- [ ] Decide bundler vs `tsc` emit given current `allowImportingTsExtensions` + `noEmit: true`.
- [ ] Point `pi.extensions` at compiled JS.
- [ ] Re-bench import; compare to Result C.
- [ ] Ship as separate PR after Phase 1 is stable.

**Validation:**

- Run: package install smoke in a clean dir + `npm run bench:import` against published layout
- Expected: import path resolves without jiti transpile of sources

---

## Final Validation

- Run: `npm test`
- Expected: full suite pass
- Run: `npm run bench:import`
- Expected: `import_ms` ≤ 50% of Baseline A; default export is function
- Run: `npx vitest run __tests__/import-graph-eager.test.ts`
- Expected: pass (banned static imports absent from factory entry)
- Optional manual: start `pi` with only this extension enabled; confirm startup log `pi-mcp-adapter` module import drops materially; factory remains ~ms-level; `/mcp` status and one tool call still work

## Failure Behavior

- Dynamic import failure on first tool/auth/UI use — surface the same error channel as today (tool error / console.error on session init); do not silently swallow.
- `recheck` load failure during regex search — preserve current “safety analysis failed” rejection path.
- Stale session generation during async init — existing `lifecycleGeneration` guards remain authoritative; lazy imports must not bypass them.
- Users with many direct tools — may still pay `typebox` + registration cost at factory; documented tradeoff.

## Privacy and Security

- No change to OAuth token storage, callback server binding, or consent flows — only load timing.
- Regex ReDoS checks remain mandatory for `regex: true` search; lazy-loading must not skip `checkSync`.
- Do not weaken output guard or auth required messaging while moving modules.

## Rollout Notes

- Pure performance refactor; no config schema migration.
- Compatible with existing installed TS layout and `package.json` `files` publishing model.
- Recommend semver **patch** if behavior-identical; **minor** only if public import paths of extracted modules are considered part of a published API (they are package-internal; patch is enough).
- Phase 2 dist changes would be **minor** and need install/docs notes.

## Risks and Mitigations

- **vitest `vi.mock` + dynamic `import()` timing** — run index-lifecycle and auth tests early; switch to explicit `await import()` in tests after mocks if needed.
- **Sync factory cannot await** — use trampolines and light sync modules; never make default export async.
- **Sync TUI renderers cannot await** — keep renderer module sync and light.
- **Regression in connect-time sampling/elicitation** — keep existing server-manager tests green; add assertion that handlers still register on connect.
- **Bench noise on Windows** — multiple runs, median of 5; gate on relative improvement + tests, not absolute ms in CI.
- **Accidental circular dynamic import** — prefer one-way lazy edges (index → heavy, not heavy → index).

## Open Questions

- None blocking Phase 1. Phase 2 dist strategy (tsc vs bundle) deferred until after Phase 1 metrics.

## Out of Scope

- Speeding up `pi-web-access` or other extensions
- Changing pi core to parallelize extension loads
- Replacing `recheck` with a custom lighter checker (lazy-load only)
- Removing MCP features (UI, sampling, OAuth)
- Dependency major upgrades
