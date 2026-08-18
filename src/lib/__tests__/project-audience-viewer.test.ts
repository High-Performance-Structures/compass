import { describe, expect, it } from "vitest"

import { toProjectAudienceViewer } from "@/lib/project-audience-viewer"

const photoUrl = "https://drive.google.com/file/d/drive-photo-id/view"

function sourceUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    displayName: "Example User",
    email: "person@example.com",
    avatarUrl: photoUrl,
    role: "client",
    isActive: true,
    organizationId: "org-1",
    organizationType: "client",
    ...overrides,
  }
}

describe("project audience viewer projection", () => {
  it("does not serialize profile photo URLs for external viewers", () => {
    expect(toProjectAudienceViewer(sourceUser(), false, "org-1")).toEqual({
      id: "user-1",
      name: "Example User",
      email: "person@example.com",
      avatarUrl: null,
      sidebarPhotoUrl: null,
    })
  })

  it("does not serialize profile photo URLs for inactive or demo viewers", () => {
    expect(
      toProjectAudienceViewer(
        sourceUser({ id: "staff-1", role: "admin", organizationType: "internal", isActive: false }),
        true,
        "org-1"
      ).avatarUrl
    ).toBeNull()
    expect(
      toProjectAudienceViewer(
        sourceUser({ id: "demo-user-001", role: "admin", organizationType: "internal" }),
        true,
        "org-1"
      ).avatarUrl
    ).toBeNull()
  })

  it("keeps an active internal staff avatar only in internal preview mode", () => {
    expect(
      toProjectAudienceViewer(
        sourceUser({ id: "staff-1", role: "admin", organizationType: "internal" }),
        true,
        "org-1"
      ).avatarUrl
    ).toBe(photoUrl)
  })

  it("redacts raw profile photos when an internal viewer previews another organization", () => {
    const viewer = toProjectAudienceViewer(
      sourceUser({
        id: "staff-1",
        role: "admin",
        organizationType: "internal",
        organizationId: "org-1",
      }),
      true,
      "org-2"
    )

    expect(viewer.avatarUrl).toBeNull()
    expect(viewer.sidebarPhotoUrl).toBeNull()
    expect(JSON.stringify(viewer)).not.toContain(photoUrl)
  })
})
