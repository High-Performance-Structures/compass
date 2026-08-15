import { describe, expect, it } from "vitest"

import { canUseProjectDailyLogWorkspace } from "@/lib/daily-logs/workspace-access"

describe("project daily log workspace access", () => {
  it("denies external project roles", () => {
    expect(canUseProjectDailyLogWorkspace("owner")).toBe(false)
    expect(canUseProjectDailyLogWorkspace("subcontractor")).toBe(false)
    expect(canUseProjectDailyLogWorkspace("supplier")).toBe(false)
  })

  it("allows internal staff roles", () => {
    expect(canUseProjectDailyLogWorkspace("project_manager")).toBe(true)
  })
})
