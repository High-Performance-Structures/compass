import { describe, expect, it } from "vitest"

import {
  assignUserToProjectSchema,
  deactivateUserSchema,
  inviteUserSchema,
  updateUserRoleSchema,
} from "../users"

describe("inviteUserSchema", () => {
  const validInvite = {
    email: "new.staff@example.com",
    role: "office",
  } as const

  it("accepts the legacy organization IDs used by Compass production", () => {
    const result = inviteUserSchema.safeParse({
      ...validInvite,
      organizationId: "org-1",
    })

    expect(result.success).toBe(true)
  })

  it("continues to accept UUID organization IDs", () => {
    const result = inviteUserSchema.safeParse({
      ...validInvite,
      organizationId: "bc817751-f289-4c57-bac7-b5bc08d3a61e",
    })

    expect(result.success).toBe(true)
  })

  it("rejects malformed organization identifiers", () => {
    const result = inviteUserSchema.safeParse({
      ...validInvite,
      organizationId: "org 1",
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid identifier format")
    }
  })
})

describe("settings user identifier validation", () => {
  it("accepts WorkOS user IDs for role and deactivation actions", () => {
    const workosUserId = "user_01KGSRW8957M25E2YJ1XTMS74Q"

    expect(
      updateUserRoleSchema.safeParse({ userId: workosUserId, role: "office" })
        .success
    ).toBe(true)
    expect(deactivateUserSchema.safeParse({ userId: workosUserId }).success).toBe(
      true
    )
  })

  it("accepts legacy project IDs when assigning a user", () => {
    const result = assignUserToProjectSchema.safeParse({
      userId: "user_01KGSRW8957M25E2YJ1XTMS74Q",
      projectId: "proj-o-202-loeffler",
      role: "field_superintendent",
    })

    expect(result.success).toBe(true)
  })
})
