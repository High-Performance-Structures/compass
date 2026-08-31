import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ canUseFieldDesk: vi.fn(() => true) }))

import { getCherishRecipientOptions } from "@/app/actions/cherish-recipients"

describe("getCherishRecipientOptions", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      organizationId: "org-1",
      organizationType: "internal",
      isActive: true,
      role: "office",
      email: "staff@example.com",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
  })

  it("returns active internal employees and excludes external roles", async () => {
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
    }
    query.from.mockReturnValue(query)
    query.innerJoin.mockReturnValue(query)
    query.where.mockReturnValue(query)
    query.orderBy.mockResolvedValue([
      {
        id: "staff-1",
        displayName: "Current User",
        firstName: null,
        lastName: null,
        email: "staff@example.com",
        role: "office",
      },
      {
        id: "staff-2",
        displayName: null,
        firstName: "Nico",
        lastName: "Flores",
        email: "nico@example.com",
        role: "field_crew",
      },
      {
        id: "client-1",
        displayName: "Client User",
        firstName: null,
        lastName: null,
        email: "client@example.com",
        role: "client",
      },
    ])
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    })

    const result = await getCherishRecipientOptions()

    expect(result).toEqual({
      success: true,
      data: [
        { id: "staff-1", name: "Current User" },
        { id: "staff-2", name: "Nico Flores" },
      ],
    })
  })
})
