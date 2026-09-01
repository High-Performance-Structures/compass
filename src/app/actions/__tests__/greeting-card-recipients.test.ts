import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canApproveGreetingCards: vi.fn(),
  canPrepareGreetingCards: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({
  canApproveGreetingCards: mocks.canApproveGreetingCards,
  canPrepareGreetingCards: mocks.canPrepareGreetingCards,
}))

import { getGreetingCardRecipientOptions } from "@/app/actions/greeting-card-recipients"

describe("getGreetingCardRecipientOptions", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      organizationId: "org-1",
      organizationType: "internal",
      role: "office",
      isActive: true,
      email: "staff@example.com",
      displayName: "Office Staff",
    })
    mocks.canPrepareGreetingCards.mockReturnValue(true)
    mocks.canApproveGreetingCards.mockReturnValue(false)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
  })

  it("offers organization clients, trade partners, and internal employees", async () => {
    const customerQuery = selectQuery([
      {
        id: "customer-1",
        name: "Jamie Client",
        company: "Client Co",
        address: "10 Oak Lane, Colorado Springs, CO 80903",
      },
    ])
    const vendorQuery = selectQuery([
      {
        id: "vendor-1",
        name: "Roofing Pros",
        category: "Subcontractor",
        address: "20 Trade Road, Denver, CO 80202",
      },
    ])
    const vendorContactQuery = selectQuery([
      {
        id: "vendor-contact-1",
        name: "Riley Roofer",
        vendorName: "Roofing Pros",
        vendorCategory: "Subcontractor",
        vendorAddress: "20 Trade Road, Denver, CO 80202",
      },
    ])
    const teamQuery = selectQuery([
      {
        id: "employee-1",
        displayName: "Taylor Teammate",
        firstName: "Taylor",
        lastName: "Teammate",
        email: "taylor@example.com",
        address: "30 Pine Street, Woodland Park, CO 80863",
        role: "field_crew",
      },
      {
        id: "developer-1",
        displayName: "Outside Developer",
        firstName: "Outside",
        lastName: "Developer",
        email: "developer@example.com",
        address: "40 Code Street, Denver, CO 80202",
        role: "developer",
      },
    ])
    const select = vi
      .fn()
      .mockReturnValueOnce(customerQuery)
      .mockReturnValueOnce(vendorQuery)
      .mockReturnValueOnce(vendorContactQuery)
      .mockReturnValueOnce(teamQuery)
    mocks.getDb.mockReturnValue({ select })

    const result = await getGreetingCardRecipientOptions()

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.map((option) => option.id)).toEqual([
      "customer:customer-1",
      "vendor_contact:vendor-contact-1",
      "vendor:vendor-1",
      "team:employee-1",
    ])
    expect(result.data.find((option) => option.id === "team:employee-1"))
      .toEqual(expect.objectContaining({ recipientType: "employee" }))
    expect(result.data.some((option) => option.id === "team:developer-1"))
      .toBe(false)
  })
})

function selectQuery(rows: readonly unknown[]): {
  readonly from: ReturnType<typeof vi.fn>
  readonly innerJoin: ReturnType<typeof vi.fn>
  readonly where: ReturnType<typeof vi.fn>
} {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  }
  query.from.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.where.mockResolvedValue(rows)
  return query
}
