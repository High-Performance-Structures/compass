import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canUseExecutiveAdmin: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({
  canUseExecutiveAdmin: mocks.canUseExecutiveAdmin,
  canUseFieldDesk: vi.fn(() => true),
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))

import {
  reviewCherishPulseResponse,
  searchCherishPulseArchive,
  submitCherishPulseResponse,
} from "@/app/actions/cherish-pulse"

describe("reviewCherishPulseResponse", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "executive-1",
      organizationId: "org-1",
      email: "executive@example.com",
    })
    mocks.canUseExecutiveAdmin.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
    mocks.revalidatePath.mockReset()
  })

  it("archives an existing approved recognition and invalidates every stream", async () => {
    const selectChain = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.get.mockResolvedValue({ id: "recognition-1" })

    const updateChain = { set: vi.fn(), where: vi.fn(), run: vi.fn() }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    })

    const result = await reviewCherishPulseResponse({
      id: "recognition-1",
      decision: "archive",
    })

    expect(result).toEqual({
      success: true,
      data: { id: "recognition-1", reviewStatus: "archived" },
    })
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewStatus: "archived",
        publishedAt: null,
      }),
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/field")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/dashboard/executive-admin/cherish",
    )
  })

  it("revalidates an employee recipient before approval", async () => {
    const responseQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    responseQuery.from.mockReturnValue(responseQuery)
    responseQuery.where.mockReturnValue(responseQuery)
    responseQuery.get.mockResolvedValue({
      id: "recognition-1",
      responseType: "shoutout",
      audienceScope: "user",
      audienceReferenceId: "staff-2",
    })
    const recipientQuery = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      get: vi.fn(),
    }
    recipientQuery.from.mockReturnValue(recipientQuery)
    recipientQuery.innerJoin.mockReturnValue(recipientQuery)
    recipientQuery.where.mockReturnValue(recipientQuery)
    recipientQuery.get.mockResolvedValue({ id: "staff-2", role: "field_crew" })

    const updateChain = { set: vi.fn(), where: vi.fn(), run: vi.fn() }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(responseQuery)
        .mockReturnValueOnce(recipientQuery),
      update: vi.fn().mockReturnValue(updateChain),
    })

    const result = await reviewCherishPulseResponse({
      id: "recognition-1",
      decision: "approve",
    })

    expect(result).toEqual({
      success: true,
      data: { id: "recognition-1", reviewStatus: "approved" },
    })
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewStatus: "approved",
        publishedAt: expect.any(String),
      }),
    )
  })
})

describe("anonymous CHERISH submissions", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      organizationId: "org-1",
      organizationType: "internal",
      isActive: true,
      role: "office",
      email: "staff@example.com",
      displayName: "Named Staff Member",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
  })

  it("keeps audit ownership but masks identity from the returned review item", async () => {
    const insertChain = { values: vi.fn(), run: vi.fn() }
    insertChain.values.mockReturnValue(insertChain)
    insertChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    })

    const result = await submitCherishPulseResponse({
      cherishValue: "Honor",
      responseType: "shoutout",
      message: "Thank you for stepping in to help the crew.",
      anonymous: true,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({
      isAnonymous: true,
      submittedByName: null,
      submittedByEmail: null,
    })
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        submittedBy: "staff-1",
        submittedByName: "Named Staff Member",
        submittedByEmail: "staff@example.com",
        isAnonymous: true,
      }),
    )
  })

  it("stores a validated employee-only shoutout", async () => {
    const recipientQuery = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      get: vi.fn(),
    }
    recipientQuery.from.mockReturnValue(recipientQuery)
    recipientQuery.innerJoin.mockReturnValue(recipientQuery)
    recipientQuery.where.mockReturnValue(recipientQuery)
    recipientQuery.get.mockResolvedValue({ id: "staff-2", role: "field_crew" })
    const insertChain = { values: vi.fn(), run: vi.fn() }
    insertChain.values.mockReturnValue(insertChain)
    insertChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(recipientQuery),
      insert: vi.fn().mockReturnValue(insertChain),
    })

    const result = await submitCherishPulseResponse({
      cherishValue: "Honor",
      responseType: "shoutout",
      message: "Thank you for helping the team.",
      recipientId: "staff-2",
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.audience).toEqual({
      scope: "user",
      recipientId: "staff-2",
    })
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceScope: "user",
        audienceReferenceId: "staff-2",
      }),
    )
  })

  it("rejects employee targeting for project wins", async () => {
    const insert = vi.fn()
    mocks.getDb.mockReturnValue({ insert })

    const result = await submitCherishPulseResponse({
      cherishValue: "Excellence",
      responseType: "win",
      message: "We passed the final inspection.",
      recipientId: "staff-2",
    })

    expect(result).toEqual({
      success: false,
      error: "Employee recipients are available only for shout-outs.",
    })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe("searchCherishPulseArchive", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "executive-1",
      organizationId: "org-1",
      email: "executive@example.com",
    })
    mocks.canUseExecutiveAdmin.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
  })

  it("returns archived matches while masking anonymous audit fields", async () => {
    const rows = [
      {
        id: "archived-1",
        cherishValue: "Integrity",
        responseType: "shoutout",
        message: "Handled the closeout with care.",
        source: "compass_dashboard",
        visibility: "team",
        reviewStatus: "archived",
        isAnonymous: true,
        submittedByName: "Hidden Staff Member",
        submittedByEmail: "hidden@example.com",
        weekStart: "2026-08-24",
        createdAt: "2026-08-25T12:00:00.000Z",
      },
    ]
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.orderBy.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue(rows)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
    })

    const result = await searchCherishPulseArchive({ query: "closeout" })

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "archived-1",
          isAnonymous: true,
          submittedByName: null,
          submittedByEmail: null,
        }),
      ],
    })
  })
})
