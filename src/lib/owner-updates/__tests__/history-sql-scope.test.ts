import { describe, expect, it } from "vitest"

import { ownerUpdateVisibleStatuses } from "@/lib/owner-updates/history"

describe("owner-update SQL visibility scope", () => {
  it("limits external readers to published and sent updates", () => {
    expect(ownerUpdateVisibleStatuses("client")).toEqual(["published", "sent"])
  })

  it("leaves internal readers unfiltered so drafts remain available", () => {
    expect(ownerUpdateVisibleStatuses("project_manager")).toBeNull()
  })

  it("limits internal-looking roles in external organizations to published data", () => {
    expect(ownerUpdateVisibleStatuses("office", "client")).toEqual([
      "published",
      "sent",
    ])
  })
})
