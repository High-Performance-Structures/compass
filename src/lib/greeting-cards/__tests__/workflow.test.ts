import { describe, expect, it } from "vitest"

import { validateGreetingCardRequest } from "@/lib/greeting-cards/workflow"

describe("greeting-card request validation", () => {
  it("accepts an e-card without requiring a mailing address", () => {
    const result = validateGreetingCardRequest({
      deliveryMethod: "digital_email",
      templateId: "appreciation",
      giftAmountCents: null,
      recipientType: "client",
      message: "Thank you for trusting our team.",
      wishes: "With appreciation,\nHPS",
      recipient: {
        firstName: "Jamie",
        lastName: "Client",
        email: "jamie@example.com",
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.deliveryMethod).toBe("digital_email")
      expect(result.data.recipient.address1).toBe("")
    }
  })

  it("requires a valid email and a controlled gift amount", () => {
    const invalidEmail = validateGreetingCardRequest({
      deliveryMethod: "digital_email",
      templateId: "appreciation",
      giftAmountCents: null,
      recipientType: "employee",
      message: "Happy anniversary!",
      wishes: "HPS",
      recipient: { firstName: "Pat", lastName: "Builder", email: "nope" },
    })
    const oversizedGift = validateGreetingCardRequest({
      deliveryMethod: "digital_email",
      templateId: "celebration",
      giftAmountCents: 50_001,
      recipientType: "employee",
      message: "Great work!",
      wishes: "HPS",
      recipient: {
        firstName: "Pat",
        lastName: "Builder",
        email: "pat@example.com",
      },
    })

    expect(invalidEmail).toEqual({
      success: false,
      error: "Add a valid recipient email address.",
    })
    expect(oversizedGift).toEqual({
      success: false,
      error: "Gift amounts must be between $5 and $500.",
    })
  })
})
