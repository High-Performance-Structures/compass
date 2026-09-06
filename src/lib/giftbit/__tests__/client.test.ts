import { describe, expect, it, vi } from "vitest"

import { createGiftbitClient } from "../client"

describe("Giftbit client", () => {
  it("creates one idempotent USA direct link", async () => {
    const fetcher = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(input)).toBe("https://api.example/papi/v1/direct_links")
        expect(init?.method).toBe("POST")
        expect(typeof init?.body).toBe("string")
        if (typeof init?.body !== "string") throw new Error("Missing request body")
        expect(JSON.parse(init.body)).toEqual({
          id: "compass-ecard-request-1",
          price_in_cents: 2500,
          region: "USA",
          link_count: 1,
          expiry: "2027-09-05",
        })
        return jsonResponse({
          direct_links: ["https://reward.giftbit.com/getReward/private-link"],
          campaign: { uuid: "campaign-1", status: "API_CREATING" },
        })
      },
    )

    const result = await client(fetcher).createDirectLink({
      id: "compass-ecard-request-1",
      priceInCents: 2500,
      region: "USA",
      expiresOn: "2027-09-05",
    })

    expect(result).toEqual({
      success: true,
      data: {
        campaignUuid: "campaign-1",
        claimUrl: "https://reward.giftbit.com/getReward/private-link",
        campaignStatus: "API_CREATING",
      },
    })
  })

  it("treats a timed-out idempotent create as safe to retry", async () => {
    const result = await client(async (): Promise<Response> => {
      throw new Error("connection closed after write")
    }).createDirectLink({
      id: "compass-ecard-request-2",
      priceInCents: 1000,
      region: "USA",
      expiresOn: "2027-09-05",
    })

    expect(result).toEqual({
      success: false,
      error: "connection closed after write",
      retrySafety: "safe",
    })
  })

  it("retrieves and cancels an unredeemed reward", async () => {
    let requestNumber = 0
    const requests: Array<{ readonly url: string; readonly method: string | null }> = []
    const fetcher = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        requests.push({ url: String(input), method: init?.method ?? null })
        requestNumber += 1
        if (requestNumber === 1) {
          return jsonResponse({
          gifts: [
            {
              uuid: "reward-1",
              campaign_uuid: "campaign-1",
              status: "SENT_AND_REDEEMABLE",
            },
          ],
          })
        }
        return jsonResponse({ gift: { status: "GIVER_CANCELLED" } })
      },
    )
    const giftbit = client(fetcher)

    const rewards = await giftbit.listRewards("campaign-1")
    const cancellation = await giftbit.cancelReward("reward-1")

    expect(rewards).toEqual({
      success: true,
      data: [
        {
          uuid: "reward-1",
          campaignUuid: "campaign-1",
          status: "SENT_AND_REDEEMABLE",
        },
      ],
    })
    expect(requests[0]?.url).toContain("campaign_uuid=campaign-1")
    expect(requests[1]?.method).toBe("DELETE")
    expect(cancellation).toEqual({ success: true, data: { cancelled: true } })
  })
})

function client(fetcher: typeof fetch): ReturnType<typeof createGiftbitClient> {
  return createGiftbitClient({
    apiKey: "test-key",
    baseUrl: "https://api.example/papi/v1",
    fetcher,
  })
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
