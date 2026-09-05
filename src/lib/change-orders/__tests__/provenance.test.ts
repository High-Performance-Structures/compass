import { describe, expect, it } from "vitest"
import { readChangeOrderRequesterType } from "@/lib/change-orders/provenance"
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
})
