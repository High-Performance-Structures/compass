import { describe, expect, it } from "vitest"

import {
  dashboardDeskPhotoStorageKey,
  sidebarDeskPhotoStorageKey,
} from "@/lib/user-photo-storage"

describe("user photo storage", () => {
  it("keeps dashboard and sidebar photos independent", () => {
    const email = "person@example.com"

    expect(dashboardDeskPhotoStorageKey(email)).toBe(
      "compass-desk-photo:person@example.com"
    )
    expect(sidebarDeskPhotoStorageKey(email)).toBe(
      "compass-sidebar-desk-photo:person@example.com"
    )
    expect(sidebarDeskPhotoStorageKey(email)).not.toBe(
      dashboardDeskPhotoStorageKey(email)
    )
  })
})
