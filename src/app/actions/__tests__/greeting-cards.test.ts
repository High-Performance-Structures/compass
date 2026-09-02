import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  canApproveGreetingCards: vi.fn(),
  canPrepareGreetingCards: vi.fn(),
  createHandwryttenClient: vi.fn(),
  createDirectLink: vi.fn(),
  createGiftbitClient: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getHandwryttenApiKey: vi.fn(),
  getHandwryttenConfig: vi.fn(),
  getGiftbitConfig: vi.fn(),
  listCards: vi.fn(),
  listRewards: vi.fn(),
  cancelReward: vi.fn(),
  revalidatePath: vi.fn(),
  requireAuth: vi.fn(),
  sendCompassEmail: vi.fn(),
  submitOrder: vi.fn(),
}))

vi.mock("server-only", () => ({}))
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
vi.mock("@/lib/giftbit/config", () => ({
  getGiftbitConfig: mocks.getGiftbitConfig,
}))
vi.mock("@/lib/giftbit/client", () => ({
  createGiftbitClient: mocks.createGiftbitClient,
}))
vi.mock("@/lib/email/compass-email", () => ({
  sendCompassEmail: mocks.sendCompassEmail,
}))

import {
  approveGreetingCardRequest,
  cancelGreetingCardRequest,
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
  deliveryMethod: "physical_mail",
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

const DIGITAL_APPROVED_ROW = {
  id: "request-digital-1",
  organizationId: "org-1",
  requestedBy: "staff-2",
  approvedBy: "staff-1",
  rejectedBy: null,
  releasedBy: null,
  deletedBy: null,
  provider: "compass",
  deliveryMethod: "digital_email",
  providerOrderId: null,
  status: "approved",
  providerCardId: "appreciation",
  cardName: "With Appreciation",
  cardPriceCents: null,
  recipientType: "client",
  occasion: "Project completion",
  message: "Thank you for trusting our team.",
  wishes: "With appreciation,\nHPS",
  recipientFirstName: "Jamie",
  recipientLastName: "Client",
  recipientBusinessName: null,
  recipientAddress1: "",
  recipientAddress2: null,
  recipientCity: "",
  recipientState: "",
  recipientPostalCode: "",
  recipientCountry: "United States",
  recipientEmail: "jamie@example.com",
  giftProvider: "giftbit",
  giftAmountCents: 2500,
  giftRegion: "USA",
  giftCampaignUuid: null,
  giftRewardUuid: null,
  giftClaimUrl: null,
  giftStatus: null,
  publicToken: "6b8bb215-7cf0-4c5c-a426-9689dd645ec7",
  emailProvider: null,
  emailProviderMessageId: null,
  openedAt: null,
  approvalNote: null,
  providerError: null,
  approvedAt: "2026-09-01T18:00:00.000Z",
  rejectedAt: null,
  releasedAt: null,
  submittedAt: null,
  cancelledAt: null,
  deletedAt: null,
  createdAt: "2026-09-01T17:00:00.000Z",
  updatedAt: "2026-09-01T18:00:00.000Z",
}

function updateRunChain(): {
  readonly set: ReturnType<typeof vi.fn>
  readonly where: ReturnType<typeof vi.fn>
  readonly run: ReturnType<typeof vi.fn>
} {
  const chain = { set: vi.fn(), where: vi.fn(), run: vi.fn() }
  chain.set.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.run.mockResolvedValue(undefined)
  return chain
}

describe("greeting-card approval workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: {},
        SOCIAL_PUBLIC_BASE_URL: "https://compass.example.com",
      },
    })
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
    mocks.getGiftbitConfig.mockReturnValue({
      success: true,
      data: {
        apiKey: "giftbit-test-key",
        environment: "testbed",
        baseUrl: "https://api-testbed.giftbit.com/papi/v1",
        orderingEnabled: true,
      },
    })
    mocks.createDirectLink.mockResolvedValue({
      success: true,
      data: {
        campaignUuid: "giftbit-campaign-1",
        claimUrl: "https://testbedreward.giftbit.com/getReward/private",
        campaignStatus: "API_CREATING",
      },
    })
    mocks.createGiftbitClient.mockReturnValue({
      createDirectLink: mocks.createDirectLink,
      listRewards: mocks.listRewards,
      cancelReward: mocks.cancelReward,
    })
    mocks.listRewards.mockResolvedValue({
      success: true,
      data: [
        {
          uuid: "giftbit-reward-1",
          campaignUuid: "giftbit-campaign-1",
          status: "SENT_AND_REDEEMABLE",
        },
      ],
    })
    mocks.cancelReward.mockResolvedValue({
      success: true,
      data: { cancelled: true },
    })
    mocks.sendCompassEmail.mockResolvedValue({
      status: "sent",
      provider: "gmail",
      providerMessageId: "message-1",
      error: null,
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

  it("purchases an approved Giftbit reward and sends the Compass e-card", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    const approvedRow = DIGITAL_APPROVED_ROW
    const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue([approvedRow])
    const claimChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() }
    claimChain.set.mockReturnValue(claimChain)
    claimChain.where.mockReturnValue(claimChain)
    claimChain.returning.mockResolvedValue([{ id: approvedRow.id }])
    const giftChain = updateRunChain()
    const finishChain = updateRunChain()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi
        .fn()
        .mockReturnValueOnce(claimChain)
        .mockReturnValueOnce(giftChain)
        .mockReturnValueOnce(finishChain),
    })

    const result = await releaseGreetingCardRequest(approvedRow.id)

    expect(result).toEqual({
      success: true,
      data: { id: approvedRow.id, status: "submitted" },
    })
    expect(mocks.createDirectLink).toHaveBeenCalledWith({
      id: `compass-ecard-${approvedRow.id}`,
      priceInCents: 2500,
      region: "USA",
    })
    expect(mocks.sendCompassEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["jamie@example.com"],
        text: expect.stringContaining(
          "https://compass.example.com/ecard/6b8bb215-7cf0-4c5c-a426-9689dd645ec7",
        ),
      }),
    )
    expect(finishChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOrderId: "giftbit-campaign-1",
        emailProvider: "gmail",
        status: "submitted",
      }),
    )
    expect(mocks.submitOrder).not.toHaveBeenCalled()
  })

  it("keeps a purchased reward cancellable when email delivery is unavailable", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    mocks.sendCompassEmail.mockResolvedValue({
      status: "pending_provider",
      provider: "none",
      providerMessageId: null,
      error: "E-card email delivery is not configured.",
    })
    const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue([DIGITAL_APPROVED_ROW])
    const claimChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() }
    claimChain.set.mockReturnValue(claimChain)
    claimChain.where.mockReturnValue(claimChain)
    claimChain.returning.mockResolvedValue([{ id: DIGITAL_APPROVED_ROW.id }])
    const giftChain = updateRunChain()
    const restoreChain = updateRunChain()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi
        .fn()
        .mockReturnValueOnce(claimChain)
        .mockReturnValueOnce(giftChain)
        .mockReturnValueOnce(restoreChain),
    })

    const result = await releaseGreetingCardRequest(DIGITAL_APPROVED_ROW.id)

    expect(result).toEqual({
      success: false,
      error:
        "E-card email delivery is not configured. The purchased gift remains available to cancel from this queue.",
    })
    expect(restoreChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs_attention" }),
    )
  })

  it("cancels an unredeemed reward from needs attention", async () => {
    mocks.canApproveGreetingCards.mockReturnValue(true)
    const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.limit.mockResolvedValue([
      {
        deliveryMethod: "digital_email",
        providerOrderId: null,
        status: "needs_attention",
        giftAmountCents: 2500,
        giftCampaignUuid: "giftbit-campaign-1",
        giftRewardUuid: null,
      },
    ])
    const claimChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() }
    claimChain.set.mockReturnValue(claimChain)
    claimChain.where.mockReturnValue(claimChain)
    claimChain.returning.mockResolvedValue([{ id: DIGITAL_APPROVED_ROW.id }])
    const finishChain = updateRunChain()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi
        .fn()
        .mockReturnValueOnce(claimChain)
        .mockReturnValueOnce(finishChain),
    })

    const result = await cancelGreetingCardRequest(DIGITAL_APPROVED_ROW.id)

    expect(result).toEqual({
      success: true,
      data: { id: DIGITAL_APPROVED_ROW.id, status: "cancelled" },
    })
    expect(mocks.listRewards).toHaveBeenCalledWith("giftbit-campaign-1")
    expect(mocks.cancelReward).toHaveBeenCalledWith("giftbit-reward-1")
    expect(finishChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        giftRewardUuid: "giftbit-reward-1",
        giftStatus: "GIVER_CANCELLED",
      }),
    )
  })
})
