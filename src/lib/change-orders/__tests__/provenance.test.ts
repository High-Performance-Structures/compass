import { describe, expect, it } from "vitest"
import { displayChangeOrderRequesterType, readChangeOrderRequesterType } from "@/lib/change-orders/provenance"
import { canViewChangeOrder, changeOrderRequesterType } from "@/lib/change-orders/access"

describe("historical requester read compatibility", () => {
  it("allows unknown only for Buildertrend imports without coercing it to internal", () => {
    expect(readChangeOrderRequesterType("buildertrend_import", "unknown")).toBe("unknown")
    expect(readChangeOrderRequesterType("internal_request", "unknown")).toBeNull()
    expect(readChangeOrderRequesterType("owner_request", "unknown")).toBeNull()
    expect(readChangeOrderRequesterType("buildertrend_import", "unrecognized")).toBeNull()
  })

  it.each(["internal", "owner", "subcontractor"])("preserves existing %s requester values", (type) => {
    expect(readChangeOrderRequesterType("internal_request", type)).toBe(type)
    expect(readChangeOrderRequesterType("buildertrend_import", type)).toBe(type)
  })

  it("does not introduce an unknown requester role or grant access to an unrelated viewer", () => {
    expect(changeOrderRequesterType({ internal: false, projectRole: "unknown" })).toBeNull()
    expect(canViewChangeOrder({
      internal: false, viewerId: "unrelated", viewerRequesterType: null,
      requesterUserId: null, audience: "owner", status: "executed",
    })).toBe(false)
    expect(canViewChangeOrder({
      internal: false, viewerId: "owner", viewerRequesterType: "owner",
      requesterUserId: null, audience: "internal", status: "draft",
    })).toBe(false)
  })

  it("still displays a record whose requester value isn't recognized, flagged for correction", () => {
    const display = displayChangeOrderRequesterType("spreadsheet_reconciliation", "staff")
    expect(display.requesterType).toBe("unknown")
    expect(display.issue).toContain('"staff"')
    expect(displayChangeOrderRequesterType("internal_request", "internal")).toEqual({
      requesterType: "internal",
      issue: null,
    })
  })
})
