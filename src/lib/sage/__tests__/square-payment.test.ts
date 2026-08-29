import { describe, expect, it } from "vitest"

import {
  departmentFromSageJob,
  SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
  SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
  sageSquarePaymentPayloadSchema,
  squareProcessingFeeExpenseCents,
} from "@/lib/sage/square-payment"
import {
  SQUARE_WEBHOOK_NOTIFICATION_URL,
  verifySquareWebhookSignature,
} from "@/lib/sage/square-webhook-auth"

function base64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes)
  let binary = ""
  for (const value of values) binary += String.fromCharCode(value)
  return btoa(binary)
}

async function signWebhook(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return base64(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${SQUARE_WEBHOOK_NOTIFICATION_URL}${body}`)
    )
  )
}

describe("Square payment webhook", () => {
  it("verifies Square's URL plus raw-body HMAC and rejects changed bodies", async () => {
    const body = '{"event_id":"event-1"}'
    const secret = "square-test-signature-key"
    const signature = await signWebhook(body, secret)

    await expect(
      verifySquareWebhookSignature(body, signature, secret)
    ).resolves.toBe(true)
    await expect(
      verifySquareWebhookSignature(`${body} `, signature, secret)
    ).resolves.toBe(false)
  })

  it("routes Sage job prefixes to the approved Square departments", () => {
    expect(departmentFromSageJob("H-403-4378 Deck Ren.")).toBe("HPS")
    expect(departmentFromSageJob("O-58-3674")).toBe("ORC")
    expect(departmentFromSageJob("D-100 Legacy")).toBe("ORC")
    expect(departmentFromSageJob("N-202 Nu-Tech")).toBe("Nu-Tech")
    expect(departmentFromSageJob("Unrouted job")).toBeNull()
  })

  it("pins Square postings to the live Sage FSB and merchant-fee accounts", () => {
    const parsed = sageSquarePaymentPayloadSchema.parse({
      operationType: "post_square_receipt",
      company: "High Performance Structures Inc",
      squarePaymentId: "payment-1",
      squareInvoiceId: "invoice-1",
      squareOrderId: "order-1",
      squareLocationId: "location-1",
      department: "HPS",
      sageInvoiceId: "123",
      sageInvoiceNumber: "INV-123",
      ownerPaymentCents: 690200,
      clientPaidFeeCents: 0,
      currency: "USD",
      depositAccountNumber: SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
      merchantFeeAccountNumber: SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
      paymentCompletedAt: "2026-08-29T00:30:00.000Z",
    })

    expect(parsed.depositAccountNumber).toBe(10000)
    expect(parsed.merchantFeeAccountNumber).toBe(62020)
  })

  it("normalizes Square fee deductions to a positive Sage expense", () => {
    expect(
      squareProcessingFeeExpenseCents([
        { amount_money: { amount: -300, currency: "USD" } },
        { amount_money: { amount: -15, currency: "USD" } },
      ])
    ).toBe(315)
    expect(squareProcessingFeeExpenseCents([])).toBe(0)
  })

  it("stops when Square fee returns exceed assessed fees", () => {
    expect(() =>
      squareProcessingFeeExpenseCents([
        { amount_money: { amount: 25, currency: "USD" } },
      ])
    ).toThrow("adjustments exceed assessed fees")
  })
})
