import { describe, expect, it } from "vitest"

import {
  canUseActiveProjectAudience,
  canUseProjectAudience,
} from "@/lib/project-audience-access"

describe("project audience access", () => {
  it.each(["client", "owner"])("allows %s to use the owner view", (role) => {
    expect(canUseProjectAudience(role, "owner")).toBe(true)
    expect(canUseProjectAudience(role, "sub_vendor")).toBe(false)
  })

  it.each(["subcontractor", "supplier"])(
    "allows %s to use only the sub/vendor view",
    (role) => {
      expect(canUseProjectAudience(role, "sub_vendor")).toBe(true)
      expect(canUseProjectAudience(role, "owner")).toBe(false)
    }
  )

  it("denies an inactive external member even with an eligible audience role", () => {
    expect(canUseActiveProjectAudience("owner", "owner", false)).toBe(false)
    expect(canUseActiveProjectAudience("supplier", "sub_vendor", false)).toBe(
      false
    )
    expect(canUseActiveProjectAudience("owner", "owner", true)).toBe(true)
  })

  it.each(["guest", "unknown", null])(
    "does not infer an audience for %s",
    (role) => {
      expect(canUseProjectAudience(role, "owner")).toBe(false)
      expect(canUseProjectAudience(role, "sub_vendor")).toBe(false)
    }
  )
})
