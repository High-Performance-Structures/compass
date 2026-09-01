import { describe, expect, it, vi } from "vitest"

import {
  createHandwryttenClient,
  type HandwryttenAddress,
} from "../client"

const ADDRESS: HandwryttenAddress = {
  firstName: "Pat",
  lastName: "Builder",
  businessName: "HPS",
  address1: "123 Main St",
  address2: "",
  city: "Denver",
  state: "CO",
  postalCode: "80202",
  country: "United States",
}

describe("Handwrytten client", () => {
  it("loads and normalizes the paginated card catalog", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const page = new URL(String(input)).searchParams.get("page")
        if (page === "0") {
          return jsonResponse({
            cards: [
              {
                id: 7,
                name: "Thank You",
                description: "A warm thank-you card",
                cover: "https://cards.example/thank-you.jpg",
                price: 3.75,
                category_name: "Gratitude",
                characters: 340,
              },
            ],
            pagination: { is_last: false },
          })
        }

        return jsonResponse({
          cards: [{ id: 8, name: "Great Work", cover: "javascript:bad" }],
          pagination: { is_last: true },
        })
      },
    )

    const result = await createHandwryttenClient({
      apiKey: "test-key",
      fetcher,
      baseUrl: "https://api.example/v2",
    }).listCards()

    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 7,
          name: "Thank You",
          description: "A warm thank-you card",
          coverUrl: "https://cards.example/thank-you.jpg",
          price: 3.75,
          categoryName: "Gratitude",
          characters: 340,
        },
        {
          id: 8,
          name: "Great Work",
          description: "",
          coverUrl: null,
          price: null,
          categoryName: "Other",
          characters: null,
        },
      ],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("with_images=true")
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("lowres=true")
  })

  it("submits a card-only order with durable client metadata", async () => {
    const fetcher = vi.fn(
      async (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(init?.headers).toEqual({
          Accept: "application/json",
          Authorization: "test-key",
          "Content-Type": "application/json",
        })
        expect(typeof init?.body).toBe("string")
        if (typeof init?.body !== "string") throw new Error("Missing JSON body")
        const body: unknown = JSON.parse(init.body)
        expect(Reflect.get(body ?? {}, "client_metadata")).toBe("fulfillment-1")
        expect(Reflect.get(body ?? {}, "card_id")).toBe(7)
        expect(Reflect.has(body ?? {}, "denomination_id")).toBe(false)
        expect(Reflect.has(body ?? {}, "gift_card_id")).toBe(false)
        return jsonResponse({ order_id: 912, mail_sent: 0 })
      },
    )

    const result = await createHandwryttenClient({
      apiKey: "test-key",
      fetcher,
      baseUrl: "https://api.example/v2",
    }).submitOrder({
      cardId: 7,
      message: "Thank you for living our values.",
      wishes: "With appreciation,\nHPS",
      fontLabel: "Casual David",
      sender: ADDRESS,
      recipient: { ...ADDRESS, firstName: "Riley" },
      clientMetadata: "fulfillment-1",
    })

    expect(result).toEqual({
      success: true,
      data: { orderId: 912, mailSent: false },
    })
  })

  it("marks a definitive provider rejection as safe to retry", async () => {
    const result = await createHandwryttenClient({
      apiKey: "test-key",
      fetcher: async (): Promise<Response> =>
        jsonResponse({ error: "Address is invalid" }, 422),
    }).submitOrder({
      cardId: 7,
      message: "Thanks",
      wishes: "HPS",
      fontLabel: "Casual David",
      sender: ADDRESS,
      recipient: ADDRESS,
      clientMetadata: "fulfillment-2",
    })

    expect(result).toEqual({
      success: false,
      error: "Address is invalid",
      retrySafety: "safe",
    })
  })

  it("marks an ambiguous network failure for manual reconciliation", async () => {
    const result = await createHandwryttenClient({
      apiKey: "test-key",
      fetcher: async (): Promise<Response> => {
        throw new Error("connection closed after write")
      },
    }).submitOrder({
      cardId: 7,
      message: "Thanks",
      wishes: "HPS",
      fontLabel: "Casual David",
      sender: ADDRESS,
      recipient: ADDRESS,
      clientMetadata: "fulfillment-3",
    })

    expect(result).toEqual({
      success: false,
      error: "connection closed after write",
      retrySafety: "unknown",
    })
  })

  it("sends a provider cancellation request", async () => {
    const fetcher = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(input)).toBe("https://api.example/v2/orders/cancel")
        expect(init?.body).toBe(JSON.stringify({ order_id: 912 }))
        return jsonResponse({ status: "ok" })
      },
    )

    const result = await createHandwryttenClient({
      apiKey: "test-key",
      fetcher,
      baseUrl: "https://api.example/v2",
    }).cancelOrder(912)

    expect(result).toEqual({ success: true, data: { cancelled: true } })
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
