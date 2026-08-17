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
    organizationType: "client",
    ...overrides,
  }
}

describe("project audience viewer projection", () => {
  it("does not serialize profile photo URLs for external viewers", () => {
    expect(toProjectAudienceViewer(sourceUser(), false)).toEqual({
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
        true
      ).avatarUrl
    ).toBeNull()
    expect(
      toProjectAudienceViewer(
        sourceUser({ id: "demo-user-001", role: "admin", organizationType: "internal" }),
        true
      ).avatarUrl
    ).toBeNull()
  })

  it("keeps an active internal staff avatar only in internal preview mode", () => {
    expect(
      toProjectAudienceViewer(
        sourceUser({ id: "staff-1", role: "admin", organizationType: "internal" }),
        true
      ).avatarUrl
    ).toBe(photoUrl)
  })
})
