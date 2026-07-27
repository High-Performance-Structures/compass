import { describe, expect, it } from "vitest"

import {
  canViewOwnerUpdateDrafts,
  isOwnerUpdateVisibleToRole,
} from "@/lib/owner-updates/history"

describe("owner update history access", () => {
  it.each([
    "admin",
    "secondary_admin",
    "office",
    "project_manager",
    "project_administrator",
    "field_superintendent",
    "field",
  ])(
    "allows %s staff to see drafts",
    (role) => {
      expect(canViewOwnerUpdateDrafts(role)).toBe(true)
      expect(isOwnerUpdateVisibleToRole("draft", role)).toBe(true)
    }
  )

  it.each(["client", "guest", "unknown"])(
    "hides drafts from %s viewers",
    (role) => {
      expect(canViewOwnerUpdateDrafts(role)).toBe(false)
      expect(isOwnerUpdateVisibleToRole("draft", role)).toBe(false)
    }
  )

  it.each(["published", "sent"])(
    "shows %s updates to owners",
    (status) => {
      expect(isOwnerUpdateVisibleToRole(status, "client")).toBe(true)
    }
  )
})
