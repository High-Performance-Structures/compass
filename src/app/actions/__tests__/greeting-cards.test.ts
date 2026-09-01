import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  canApproveGreetingCards: vi.fn(),
  canPrepareGreetingCards: vi.fn(),
  createHandwryttenClient: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getHandwryttenApiKey: vi.fn(),
  getHandwryttenConfig: vi.fn(),
  listCards: vi.fn(),
  revalidatePath: vi.fn(),
  requireAuth: vi.fn(),
  submitOrder: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({
  canApproveGreetingCards: mocks.canApproveGreetingCards,
  canPrepareGreetingCards: mocks.canPrepareGreetingCards,
}))
vi.mock("@/lib/handwrytten/config", () => ({
  getHandwryttenApiKey: mocks.getHandwryttenApiKey,
  getHandwryttenConfig: mocks.getHandwryttenConfig,
}))
vi.mock("@/lib/handwrytten/client", () => ({
  createHandwryttenClient: mocks.createHandwryttenClient,
}))

import {
  approveGreetingCardRequest,
  releaseGreetingCardRequest,
  submitGreetingCardRequest,
  type SubmitGreetingCardRequestInput,
} from "@/app/actions/greeting-cards"

const CARD = {
  id: 42,
  name: "Thank You",
  description: "A thank-you card",
  coverUrl: null,
  price: 5,
  categoryName: "Business",
  characters: 500,
}

const REQUEST_INPUT: SubmitGreetingCardRequestInput = {
  cardId: 42,
  recipientType: "subcontractor",
  occasion: "Project completion",
  message: "Thank you for the excellent work.",
  wishes: "With appreciation,\nHPS",
  recipient: {
    firstName: "Alex",
    lastName: "Trade",
    businessName: "Trade Partner LLC",
    address1: "100 Main Street",
    city: "Denver",
    state: "CO",
    postalCode: "80202",
  },
}

describe("greeting-card approval workflow", () => {
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
    mocks.getHandwryttenApiKey.mockReturnValue({
      success: true,
      apiKey: "test-key",
    })
    mocks.getHandwryttenConfig.mockReturnValue({
      success: true,
      data: {
        apiKey: "test-key",
        fontLabel: "Casual David",
        sender: {
          firstName: "",
          lastName: "",
          businessName: "HPS",
          address1: "1 Office Way",
          address2: "",
          city: "Denver",
          state: "CO",
          postalCode: "80202",
          country: "United States",
        },
      },
    })
    mocks.listCards.mockResolvedValue({ success: true, data: [CARD] })
    mocks.submitOrder.mockResolvedValue({
      success: true,
      data: { orderId: 7001, mailSent: false },
    })
    mocks.createHandwryttenClient.mockReturnValue({
      listCards: mocks.listCards,
      submitOrder: mocks.submitOrder,
      cancelOrder: vi.fn(),
    })
    mocks.getDb.mockReset()
    mocks.revalidatePath.mockReset()
  })

  it("lets office staff submit a non-billable request for approval", async () => {
    const insertChain = { values: vi.fn(), run: vi.fn() }
    insertChain.values.mockReturnValue(insertChain)
    insertChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    })

    const result = await submitGreetingCardRequest(REQUEST_INPUT)

    expect(result.success).toBe(true)
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedBy: "staff-1",
        status: "pending_approval",
        recipientType: "subcontractor",
      }),
    )
    expect(mocks.submitOrder).not.toHaveBeenCalled()
  })

  it("records approval without releasing a provider order", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    const updateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.returning.mockResolvedValue([{ id: "request-1" }])
    mocks.getDb.mockReturnValue({
      update: vi.fn().mockReturnValue(updateChain),
    })

    const result = await approveGreetingCardRequest("request-1")

    expect(result).toEqual({
      success: true,
      data: { id: "request-1", status: "approved" },
    })
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        approvedBy: "staff-1",
        approvedAt: expect.any(String),
      }),
    )
    expect(mocks.submitOrder).not.toHaveBeenCalled()
  })

  it("does not release a request that is not in the approved state", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue([])
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
    })

    const result = await releaseGreetingCardRequest("request-1")

    expect(result).toEqual({
      success: false,
      error: "Approve this request before releasing it.",
    })
    expect(mocks.submitOrder).not.toHaveBeenCalled()
  })

  it("places the Handwrytten order only from an approved request", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    const approvedRow = {
      id: "request-1",
      organizationId: "org-1",
      requestedBy: "staff-2",
      approvedBy: "staff-1",
      rejectedBy: null,
      releasedBy: null,
      deletedBy: null,
      provider: "handwrytten",
      deliveryMethod: "physical_mail",
      providerOrderId: null,
      status: "approved",
      providerCardId: "42",
      cardName: "Thank You",
      cardPriceCents: 500,
      recipientType: "subcontractor",
      occasion: null,
      message: "Thank you for the excellent work.",
      wishes: "With appreciation,\nHPS",
      recipientFirstName: "Alex",
      recipientLastName: "Trade",
      recipientBusinessName: "Trade Partner LLC",
      recipientAddress1: "100 Main Street",
      recipientAddress2: null,
      recipientCity: "Denver",
      recipientState: "CO",
      recipientPostalCode: "80202",
      recipientCountry: "United States",
      approvalNote: null,
      providerError: null,
      approvedAt: "2026-08-31T18:00:00.000Z",
      rejectedAt: null,
      releasedAt: null,
      submittedAt: null,
      cancelledAt: null,
      deletedAt: null,
      createdAt: "2026-08-31T17:00:00.000Z",
      updatedAt: "2026-08-31T18:00:00.000Z",
    }
    const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue([approvedRow])
    const claimChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() }
    claimChain.set.mockReturnValue(claimChain)
    claimChain.where.mockReturnValue(claimChain)
    claimChain.returning.mockResolvedValue([{ id: "request-1" }])
    const finishChain = { set: vi.fn(), where: vi.fn(), run: vi.fn() }
    finishChain.set.mockReturnValue(finishChain)
    finishChain.where.mockReturnValue(finishChain)
    finishChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi
        .fn()
        .mockReturnValueOnce(claimChain)
        .mockReturnValueOnce(finishChain),
    })

    const result = await releaseGreetingCardRequest("request-1")

    expect(result).toEqual({
      success: true,
      data: { id: "request-1", status: "submitted" },
    })
    expect(claimChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "submitting",
        releasedBy: "staff-1",
      }),
    )
    expect(mocks.submitOrder).toHaveBeenCalledOnce()
    expect(finishChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOrderId: "7001",
        status: "submitted",
      }),
    )
  })
})
