import { describe, expect, it } from "vitest"

import {
  authorizedWorkspacePhotoUrl,
  controlledDeskPhotoUrl,
  dashboardDeskPhotoStorageKey,
  isLegacyDeskPhotoValue,
  isDeskPhotoSlot,
  parseControlledDeskPhoto,
  parseImageDataUrl,
  sidebarDeskPhotoStorageKey,
  workspacePhotoStateKey,
} from "@/lib/user-photo-storage"

describe("user photo storage", () => {
  it("keeps dashboard and sidebar photos independent", () => {
    const userId = "user-123"

    expect(dashboardDeskPhotoStorageKey(userId, "org-123")).toBe(
      "compass-desk-photo:user-123:org-123:dashboard"
    )
    expect(sidebarDeskPhotoStorageKey(userId, "org-123")).toBe(
      "compass-desk-photo:user-123:org-123:sidebar"
    )
    expect(sidebarDeskPhotoStorageKey(userId, "org-123")).not.toBe(
      dashboardDeskPhotoStorageKey(userId, "org-123")
    )
  })

  it("does not share a cache key when an email address is reused by another user", () => {
    expect(dashboardDeskPhotoStorageKey("user-123", "org-123")).not.toBe(
      dashboardDeskPhotoStorageKey("user-456", "org-123")
    )
  })

  it.each(["dashboard", "sidebar"] as const)(
    "synchronously redacts stale %s photo state after authorization is removed",
    (slot) => {
      const authorizedScope = workspacePhotoStateKey({
        userId: "user-123",
        organizationId: "org-123",
        slot,
        canUseWorkspacePhotos: true,
        serverPhotoUrl: null,
      })
      const unauthorizedScope = workspacePhotoStateKey({
        userId: "user-123",
        organizationId: "org-123",
        slot,
        canUseWorkspacePhotos: false,
        serverPhotoUrl: null,
      })

      expect(unauthorizedScope).not.toBe(authorizedScope)
      expect(
        authorizedWorkspacePhotoUrl({
          canUseWorkspacePhotos: false,
          currentScope: unauthorizedScope,
          loadedScope: authorizedScope,
          photoUrl: "data:image/png;base64,AQID",
        })
      ).toBeNull()
    }
  )

  it("keeps an authorized photo visible only in its current state scope", () => {
    const scope = workspacePhotoStateKey({
      userId: "user-123",
      organizationId: "org-123",
      slot: "dashboard",
      canUseWorkspacePhotos: true,
      serverPhotoUrl: "/api/users/desk-photo?slot=dashboard&file=file-1",
    })

    expect(
      authorizedWorkspacePhotoUrl({
        canUseWorkspacePhotos: true,
        currentScope: scope,
        loadedScope: scope,
        photoUrl: "/api/users/desk-photo?slot=dashboard&file=file-1",
      })
    ).toBe("/api/users/desk-photo?slot=dashboard&file=file-1")
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
