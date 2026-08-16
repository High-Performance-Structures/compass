import { describe, expect, it } from "vitest"

import {
  dashboardDeskPhotoStorageKey,
  sidebarDeskPhotoStorageKey,
} from "@/lib/user-photo-storage"

describe("user photo storage", () => {
  it("keeps dashboard and sidebar photos independent", () => {
    const scope = {
      organizationId: "org-1",
      userId: "user-1",
    }

    expect(dashboardDeskPhotoStorageKey(scope)).toBe(
      "compass-workspace-photo:org-1:user-1:dashboard"
    )
    expect(sidebarDeskPhotoStorageKey(scope)).toBe(
      "compass-workspace-photo:org-1:user-1:sidebar"
    )
    expect(sidebarDeskPhotoStorageKey(scope)).not.toBe(
      dashboardDeskPhotoStorageKey(scope)
    )
  })
})
