import { describe, expect, it } from "vitest"

import {
  controlledDeskPhotoUrl,
  dashboardDeskPhotoStorageKey,
  isLegacyDeskPhotoValue,
  isDeskPhotoSlot,
  parseControlledDeskPhoto,
  parseImageDataUrl,
  sidebarDeskPhotoStorageKey,
} from "@/lib/user-photo-storage"

describe("user photo storage", () => {
  it("keeps dashboard and sidebar photos independent", () => {
    const email = "person@example.com"

    expect(dashboardDeskPhotoStorageKey(email, "org-123")).toBe(
      `compass-desk-photo:org-123:${email}`
    )
    expect(sidebarDeskPhotoStorageKey(email, "org-123")).toBe(
      "compass-sidebar-desk-photo:org-123:person@example.com"
    )
    expect(sidebarDeskPhotoStorageKey(email, "org-123")).not.toBe(
      dashboardDeskPhotoStorageKey(email, "org-123")
    )
  })

  it("round-trips only controlled, slot-specific photo URLs", () => {
    const url = controlledDeskPhotoUrl("dashboard", "drive-file-123")

    expect(parseControlledDeskPhoto(url, "dashboard")).toEqual({
      fileId: "drive-file-123",
    })
    expect(parseControlledDeskPhoto(url, "sidebar")).toBeNull()
    expect(
      parseControlledDeskPhoto(
        "https://drive.google.com/file/d/drive-file-123/view",
        "dashboard"
      )
    ).toBeNull()
    expect(
      parseControlledDeskPhoto(
        "/api/users/desk-photo?slot=dashboard&file=other-file",
        "dashboard"
      )
    ).toEqual({ fileId: "other-file" })
  })

  it("decodes only supported image data URLs for legacy migration", () => {
    expect(parseImageDataUrl("data:image/jpeg;base64,AQID")).toEqual({
      mimeType: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(parseImageDataUrl("data:text/plain;base64,AQID")).toBeNull()
    expect(parseImageDataUrl("not-an-image")).toBeNull()
  })

  it("recognizes legacy image values without treating controlled URLs as cache data", () => {
    expect(isLegacyDeskPhotoValue("data:image/png;base64,AQID")).toBe(true)
    expect(
      isLegacyDeskPhotoValue(
        controlledDeskPhotoUrl("sidebar", "drive-file-123")
      )
    ).toBe(false)
    expect(isLegacyDeskPhotoValue("__hidden__")).toBe(false)
  })

  it("rejects unknown photo slots at runtime", () => {
    expect(isDeskPhotoSlot("dashboard")).toBe(true)
    expect(isDeskPhotoSlot("sidebar")).toBe(true)
    expect(isDeskPhotoSlot("profile")).toBe(false)
  })
})
