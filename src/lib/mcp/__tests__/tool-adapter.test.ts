import { describe, it, expect, vi, beforeEach } from "vitest"

// mock all heavy external deps before importing the module
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi
    .fn()
    .mockResolvedValue({ env: { DB: {} } }),
}))
vi.mock("@/db", () => ({
  getDb: vi.fn().mockReturnValue({
    query: {},
  }),
}))
vi.mock("@/lib/agent/memory", () => ({
  saveMemory: vi.fn(),
  searchMemories: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/app/actions/plugins", () => ({
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  toggleSkill: vi.fn(),
  getInstalledSkills: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/app/actions/themes", () => ({
  getCustomThemes: vi
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  setUserThemePreference: vi
    .fn()
    .mockResolvedValue({ success: true }),
}))
vi.mock("@/app/actions/dashboards", () => ({
  getCustomDashboards: vi
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
}))
vi.mock("@/lib/theme/presets", () => ({
  THEME_PRESETS: [
    {
      id: "default",
      name: "Default",
      description: "Default theme",
    },
  ],
}))

import {
  executeBridgeTool,
  getAvailableTools,
} from "../tool-adapter"

describe("executeBridgeTool", () => {
  it("returns error for unknown tool", async () => {
    const result = await executeBridgeTool(
      "nonexistentTool",
      "user-1",
      "member",
      {},
      ["read"],
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("unknown tool")
    }
  })

  it("read scope cannot access write tools", async () => {
    const result = await executeBridgeTool(
      "rememberContext",
      "user-1",
      "member",
      { content: "test", memoryType: "note" },
      ["read"],
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("insufficient scope")
      expect(result.error).toContain('"write"')
    }
  })

  it("read scope cannot access admin tools", async () => {
    const result = await executeBridgeTool(
      "installSkill",
      "user-1",
      "admin",
      { source: "github:foo/bar" },
      ["read"],
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("insufficient scope")
    }
  })

  it("write scope cannot access admin tools", async () => {
    const result = await executeBridgeTool(
      "installSkill",
      "user-1",
      "admin",
      { source: "github:foo/bar" },
      ["write"],
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("insufficient scope")
    }
  })

  it("write scope can access read tools", async () => {
    const result = await executeBridgeTool(
      "listThemes",
      "user-1",
      "member",
      {},
      ["write"],
    )
    expect(result.success).toBe(true)
  })

  it("admin scope can access read tools", async () => {
    const result = await executeBridgeTool(
      "listThemes",
      "user-1",
      "member",
      {},
      ["admin"],
    )
    expect(result.success).toBe(true)
  })

  it("admin scope can access write tools", async () => {
    const result = await executeBridgeTool(
      "setTheme",
      "user-1",
      "member",
      { themeId: "default" },
      ["admin"],
    )
    // setTheme calls a mocked function, should succeed
    expect(result.success).toBe(true)
  })

  it("catches handler errors and returns failure", async () => {
    // recallMemory calls searchMemories which we can make throw
    const { searchMemories } = await import(
      "@/lib/agent/memory"
    )
    vi.mocked(searchMemories).mockRejectedValueOnce(
      new Error("db connection lost"),
    )

    const result = await executeBridgeTool(
      "recallMemory",
      "user-1",
      "member",
      { query: "test" },
      ["read"],
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe("db connection lost")
    }
  })
})

describe("getAvailableTools", () => {
  it("returns only read tools for read scope", () => {
    const tools = getAvailableTools(["read"])
    const scopes = tools.map((t) => t.scope)
    expect(scopes.every((s) => s === "read")).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
  })

  it("returns read + write tools for write scope", () => {
    const tools = getAvailableTools(["write"])
    const scopes = new Set(tools.map((t) => t.scope))
    expect(scopes.has("read")).toBe(true)
    expect(scopes.has("write")).toBe(true)
    expect(scopes.has("admin")).toBe(false)
  })

  it("returns all tools for admin scope", () => {
    const tools = getAvailableTools(["admin"])
    const scopes = new Set(tools.map((t) => t.scope))
    expect(scopes.has("read")).toBe(true)
    expect(scopes.has("write")).toBe(true)
    expect(scopes.has("admin")).toBe(true)
  })

  it("admin scope returns more tools than read scope", () => {
    const readTools = getAvailableTools(["read"])
    const adminTools = getAvailableTools(["admin"])
    expect(adminTools.length).toBeGreaterThan(
      readTools.length,
    )
  })

  it("every tool has name, description, scope", () => {
    const tools = getAvailableTools(["admin"])
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(
        ["read", "write", "admin"].includes(tool.scope),
      ).toBe(true)
    }
  })

  it("returns empty array for empty scopes", () => {
    const tools = getAvailableTools([])
    expect(tools.length).toBe(0)
  })

  it("returns empty array for invalid scope", () => {
    const tools = getAvailableTools(["bogus"])
    expect(tools.length).toBe(0)
  })
})
