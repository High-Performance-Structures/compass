import { describe, expect, it } from "vitest"

import {
  canManageWorkspacePhoto,
  resolveWorkspacePhoto,
  WORKSPACE_PHOTO_REMOVED,
  type WorkspacePhotoActor,
} from "@/lib/workspace-photo-policy"

const internalActor: WorkspacePhotoActor = {
  userId: "user-1",
  organizationId: "org-1",
  organizationType: "internal",
  role: "office",
  isActive: true,
  isDemo: false,
}

const ownPhoto = {
  userId: "user-1",
  organizationId: "org-1",
}

describe("workspace photo policy", () => {
  it("allows only the current internal user in the active organization", () => {
    expect(canManageWorkspacePhoto({ actor: internalActor, photo: ownPhoto })).toBe(true)
    expect(
      canManageWorkspacePhoto({
        actor: internalActor,
        photo: { userId: "user-2", organizationId: "org-1" },
      })
    ).toBe(false)
    expect(
      canManageWorkspacePhoto({
        actor: internalActor,
        photo: { userId: "user-1", organizationId: "org-2" },
      })
    ).toBe(false)
  })

  it("rejects demo and external users even when their identifiers match", () => {
    expect(
      canManageWorkspacePhoto({
        actor: { ...internalActor, isDemo: true },
        photo: ownPhoto,
      })
    ).toBe(false)
    expect(
      canManageWorkspacePhoto({
        actor: { ...internalActor, role: "client" },
        photo: ownPhoto,
      })
    ).toBe(false)
    expect(
      canManageWorkspacePhoto({
        actor: { ...internalActor, isActive: false },
        photo: ownPhoto,
      })
    ).toBe(false)
    expect(
      canManageWorkspacePhoto({
        actor: { ...internalActor, organizationType: "client" },
        photo: ownPhoto,
      })
    ).toBe(false)
  })

  it("uses durable profile data before a browser cache", () => {
    expect(
      resolveWorkspacePhoto({
        durablePhoto: "durable-photo",
        cachedPhoto: "cached-photo",
        allowCache: true,
      })
    ).toBe("durable-photo")
    expect(
      resolveWorkspacePhoto({
        durablePhoto: null,
        cachedPhoto: "cached-photo",
        allowCache: true,
      })
    ).toBe("cached-photo")
  })

  it("does not restore cached or removed photos outside the authorized path", () => {
    expect(
      resolveWorkspacePhoto({
        durablePhoto: null,
        cachedPhoto: "stale-photo",
        allowCache: false,
      })
    ).toBeNull()
    expect(
      resolveWorkspacePhoto({
        durablePhoto: null,
        cachedPhoto: null,
        allowCache: false,
      })
    ).toBeNull()
    expect(
      resolveWorkspacePhoto({
        durablePhoto: WORKSPACE_PHOTO_REMOVED,
        cachedPhoto: "stale-photo",
        allowCache: true,
      })
    ).toBeNull()
  })
})
