import { describe, expect, it } from "vitest"

import { projectContactInvitationTarget } from "@/lib/project-contact-invitation-target"

describe("projectContactInvitationTarget", () => {
  it("uses the explicit account ID even when its contact email differs", () => {
    expect(projectContactInvitationTarget({
      linkedUserId: "user-123",
      directoryEmail: "other-person@example.com",
    })).toEqual({ kind: "linked_user", userId: "user-123" })
  })

  it("allows a linked person with no directory email", () => {
    expect(projectContactInvitationTarget({
      linkedUserId: "user-123",
      directoryEmail: null,
    })).toEqual({ kind: "linked_user", userId: "user-123" })
  })

  it("matches by normalized email only when no account is linked", () => {
    expect(projectContactInvitationTarget({
      linkedUserId: null,
      directoryEmail: " Person@Example.com ",
    })).toEqual({ kind: "email", email: "person@example.com" })
    expect(projectContactInvitationTarget({
      linkedUserId: null,
      directoryEmail: null,
    })).toBeNull()
  })
})
