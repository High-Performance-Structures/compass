import { describe, expect, it } from "vitest"

import {
  canViewChangeOrder,
  changeOrderRequesterType,
} from "@/lib/change-orders/access"
import type { AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"

function user(role: string): AuthUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    firstName: null,
    lastName: null,
    displayName: role,
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org",
    organizationName: "Organization",
    organizationType: role === "client" ? "client" : "internal",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  }
}

describe("change order audience access", () => {
  it("accepts internal, owner, and subcontractor requesters only", () => {
    expect(
      changeOrderRequesterType({ internal: true, projectRole: null })
    ).toBe("internal")
    expect(
      changeOrderRequesterType({ internal: false, projectRole: "client" })
    ).toBe("owner")
    expect(
      changeOrderRequesterType({
        internal: false,
        projectRole: "subcontractor",
      })
    ).toBe("subcontractor")
    expect(
      changeOrderRequesterType({ internal: false, projectRole: "supplier" })
    ).toBeNull()
    expect(
      changeOrderRequesterType({ internal: false, projectRole: "guest" })
    ).toBeNull()
  })

  it("grants request creation to clients and subcontractors, not generic guests or suppliers", () => {
    expect(can(user("client"), "changeorder", "create")).toBe(true)
    expect(can(user("subcontractor"), "changeorder", "create")).toBe(true)
    expect(can(user("supplier"), "changeorder", "create")).toBe(false)
    expect(can(user("guest"), "changeorder", "create")).toBe(false)
  })

  it("keeps owner requests visible to their requester during internal review", () => {
    expect(
      canViewChangeOrder({
        internal: false,
        viewerId: "owner-one",
        viewerRequesterType: "owner",
        requesterUserId: "owner-one",
        audience: "owner",
        status: "triage",
      })
    ).toBe(true)
  })

  it("shows other owner requests only after explicit owner approval", () => {
    expect(
      canViewChangeOrder({
        internal: false,
        viewerId: "owner-two",
        viewerRequesterType: "owner",
        requesterUserId: "owner-one",
        audience: "owner",
        status: "internal_review",
      })
    ).toBe(false)
    expect(
      canViewChangeOrder({
        internal: false,
        viewerId: "owner-two",
        viewerRequesterType: "owner",
        requesterUserId: "owner-one",
        audience: "owner",
        status: "approved_for_owner",
      })
    ).toBe(true)
  })

  it("never broadens one subcontractor's request to another subcontractor", () => {
    expect(
      canViewChangeOrder({
        internal: false,
        viewerId: "sub-two",
        viewerRequesterType: "subcontractor",
        requesterUserId: "sub-one",
        audience: "sub_vendor",
        status: "closed",
      })
    ).toBe(false)
  })
})
