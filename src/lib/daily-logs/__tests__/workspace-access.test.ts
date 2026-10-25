import { describe, expect, it } from "vitest"

import { canUseProjectDailyLogWorkspace } from "@/lib/daily-logs/workspace-access"

describe("daily log workspace access", () => {
  it.each([
    ["external owner", "client", true, "client", false],
    ["inactive staff", "admin", false, "internal", false],
    ["staff in a client organization", "admin", true, "client", false],
    ["active internal staff", "admin", true, "internal", true],
  ] as const)(
    "classifies %s before workspace data selection",
    (_label, role, isActive, organizationType, expected) => {
      expect(
        canUseProjectDailyLogWorkspace({
          role,
          isActive,
          organizationType,
        })
      ).toBe(expected)
    }
  )
})
