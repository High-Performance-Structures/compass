import { describe, expect, it } from "vitest"

import { ownerUpdateVisibleStatuses } from "@/lib/owner-updates/history"

describe("owner-update SQL visibility scope", () => {
  it("limits external readers to published and sent updates", () => {
    expect(ownerUpdateVisibleStatuses("client")).toEqual(["published", "sent"])
  })

  it("leaves internal readers unfiltered so drafts remain available", () => {
    expect(ownerUpdateVisibleStatuses("project_manager")).toBeNull()
  })
})
