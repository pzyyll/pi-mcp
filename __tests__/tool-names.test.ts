// ABOUTME: Unit tests for pure tool name prefixing and exclusion helpers.
// ABOUTME: Guards cold-path naming rules without loading stream/zod modules.
import { describe, expect, it } from "vitest";
import { formatToolName, getServerPrefix, isToolExcluded } from "../src/tool-names.ts";

describe("getServerPrefix", () => {
  it("returns empty string for none mode", () => {
    expect(getServerPrefix("github-mcp", "none")).toBe("");
  });

  it("replaces hyphens for server mode", () => {
    expect(getServerPrefix("github-mcp", "server")).toBe("github_mcp");
  });

  it("strips trailing -mcp for short mode", () => {
    expect(getServerPrefix("github-mcp", "short")).toBe("github");
  });

  it("falls back to mcp when short strip empties the name", () => {
    expect(getServerPrefix("mcp", "short")).toBe("mcp");
    expect(getServerPrefix("-mcp", "short")).toBe("mcp");
  });
});

describe("formatToolName", () => {
  it("prefixes with server name in server mode", () => {
    expect(formatToolName("list_issues", "github-mcp", "server")).toBe("github_mcp_list_issues");
  });

  it("uses short prefix when requested", () => {
    expect(formatToolName("list_issues", "github-mcp", "short")).toBe("github_list_issues");
  });

  it("returns bare tool name when prefix is none", () => {
    expect(formatToolName("list_issues", "github-mcp", "none")).toBe("list_issues");
  });
});

describe("isToolExcluded", () => {
  it("returns false when exclude list is empty", () => {
    expect(isToolExcluded("list_issues", "github-mcp", "server", [])).toBe(false);
    expect(isToolExcluded("list_issues", "github-mcp", "server", undefined)).toBe(false);
  });

  it("matches bare, prefixed, and hyphen/underscore variants", () => {
    expect(isToolExcluded("list-issues", "github-mcp", "server", ["list_issues"])).toBe(true);
    expect(isToolExcluded("list_issues", "github-mcp", "server", ["github_mcp_list_issues"])).toBe(
      true,
    );
    expect(isToolExcluded("list_issues", "github-mcp", "short", ["github_list_issues"])).toBe(true);
  });

  it("matches alternate prefix modes in the exclude list", () => {
    // Config may list the server-prefixed name while runtime uses short prefix.
    expect(isToolExcluded("list_issues", "github-mcp", "short", ["github_mcp_list_issues"])).toBe(
      true,
    );
  });

  it("ignores non-string exclude entries", () => {
    expect(isToolExcluded("list_issues", "github-mcp", "server", [1, null, {}])).toBe(false);
  });
});
