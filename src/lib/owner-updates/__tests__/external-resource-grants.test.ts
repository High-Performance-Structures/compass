import { describe, expect, it } from "vitest"

import { selectedOwnerUpdateResourceIdsForViewer } from "@/lib/owner-updates/external-resource-grants"

describe("owner update external resource grants", () => {
  it("does not expose an ungranted selected photo to an external viewer", () => {
    expect(
      selectedOwnerUpdateResourceIdsForViewer({
        isInternal: false,
        grantedResourceIds: ["photo-granted"],
        selectedResourceIds: ["photo-ungranted", "photo-granted"],
      })
    ).toEqual(["photo-granted"])
  })

  it("keeps the selected review set for internal staff", () => {
    expect(
      selectedOwnerUpdateResourceIdsForViewer({
        isInternal: true,
        grantedResourceIds: [],
        selectedResourceIds: ["photo-ungranted", "photo-granted"],
      })
    ).toEqual(["photo-ungranted", "photo-granted"])
  })
})
