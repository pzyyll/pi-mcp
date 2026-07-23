// ABOUTME: Covers host peer bridge seeding and host-path resolution fallbacks.
// ABOUTME: Ensures lazy native ESM chunks can use peers without package dependencies.
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureHostPiTui,
  getHostPiTui,
  resetHostPeersForTests,
  seedHostPiTui,
} from "../src/host-peers.ts";

afterEach(async () => {
  // Restore the setup-file seed so later test files in this worker keep sync getHostPiTui().
  resetHostPeersForTests();
  await ensureHostPiTui();
});

describe("host-peers", () => {
  it("returns seeded pi-tui peers synchronously", async () => {
    resetHostPeersForTests();
    const peers = await ensureHostPiTui();
    seedHostPiTui(peers);
    const got = getHostPiTui();
    expect(typeof got.matchesKey).toBe("function");
    expect(typeof got.truncateToWidth).toBe("function");
    expect(typeof got.visibleWidth).toBe("function");
    expect(typeof got.Text).toBe("function");
    expect(got.matchesKey("\x1b[A", "up")).toBe(true);
  });

  it("ensureHostPiTui resolves from workspace node_modules when unseeded", async () => {
    resetHostPeersForTests();
    const peers = await ensureHostPiTui();
    expect(peers.matchesKey("\r", "return")).toBe(true);
    // Cached on the process store for subsequent sync get.
    expect(getHostPiTui()).toBe(peers);
  });

  it("getHostPiTui throws a clear error before seed/ensure", () => {
    resetHostPeersForTests();
    expect(() => getHostPiTui()).toThrow(/not seeded/i);
  });
});
