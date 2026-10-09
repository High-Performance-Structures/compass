import { describe, expect, it } from "vitest"

import {
  departmentFromSageJob,
  isSageSquareWriterOperation,
  SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
  SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
  sageSquarePaymentPayloadSchema,
  sageSquareInitialOperationStatus,
  squareBridgeOrderAmounts,
  squareProcessingFeeExpenseCents,
  validateSquarePaymentFundingType,
} from "@/lib/sage/square-payment"
import {
  SQUARE_WEBHOOK_NOTIFICATION_URL,
  verifySquareWebhookSignature,
} from "@/lib/sage/square-webhook-auth"
import { manualReceiptNotificationBody } from "@/lib/sage/square-payment-notifications"
import { squareOwnerReceivableIds } from "@/lib/sage/square-receivable"

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
      organizationId: "org-1",
      projectId: "project-1",
      sageJobShortName: "H-403-4378",
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

  it("keeps pre-project-link fee payloads readable during deployment", () => {
    const parsed = sageSquarePaymentPayloadSchema.safeParse({
      operationType: "post_square_processing_fee",
      company: "High Performance Structures Inc",
      squarePaymentId: "payment-legacy",
      squareInvoiceId: "invoice-legacy",
      squareOrderId: "order-legacy",
      squareLocationId: "location-legacy",
      department: "HPS",
      sageInvoiceId: "123",
      sageInvoiceNumber: "INV-123",
      processingFeeCents: 200,
      currency: "USD",
      depositAccountNumber: SAGE_SQUARE_DEPOSIT_ACCOUNT_NUMBER,
      merchantFeeAccountNumber: SAGE_SQUARE_MERCHANT_FEE_ACCOUNT_NUMBER,
      paymentCompletedAt: "2026-08-29T00:30:00.000Z",
    })

    expect(parsed.success).toBe(true)
  })

  it("stages receipts for the supported Sage UI path and exposes only fees to the writer", () => {
    expect(sageSquareInitialOperationStatus("post_square_receipt")).toBe(
      "manual_action_required"
    )
    expect(
      sageSquareInitialOperationStatus("post_square_processing_fee")
    ).toBe("queued")
    expect(isSageSquareWriterOperation("post_square_receipt")).toBe(false)
    expect(isSageSquareWriterOperation("post_square_processing_fee")).toBe(
      true
    )
  })

  it("nets Square fee assessments and returns into a Sage expense", () => {
    expect(
      squareProcessingFeeExpenseCents([
        { amount_money: { amount: 300, currency: "USD" } },
        { amount_money: { amount: 15, currency: "USD" } },
      ])
    ).toBe(315)
    expect(
      squareProcessingFeeExpenseCents([
        { amount_money: { amount: 300, currency: "USD" } },
        { amount_money: { amount: -15, currency: "USD" } },
      ])
    ).toBe(285)
    expect(squareProcessingFeeExpenseCents([])).toBe(0)
  })

  it("separates the approved 2% credit fee from the Sage receivable", () => {
    expect(
      squareBridgeOrderAmounts(
        {
          id: "order-1",
          location_id: "location-1",
          reference_id: "sage-ar-invoice:123",
          total_money: { amount: 704004, currency: "USD" },
          service_charges: [
            {
              uid: "hps-credit-card-fee",
              name: "Credit card fee (2%)",
              percentage: "2",
              calculation_phase: "TOTAL_PHASE",
              taxable: false,
              scope: "ORDER",
              applied_money: { amount: 13804, currency: "USD" },
              total_money: { amount: 13804, currency: "USD" },
              total_tax_money: { amount: 0, currency: "USD" },
            },
          ],
        },
        "CREDIT"
      )
    ).toEqual({ ownerPaymentCents: 690200, clientPaidFeeCents: 13804 })
  })

  it("rejects client fees on debit and ACH routes", () => {
    expect(() =>
      squareBridgeOrderAmounts(
        {
          id: "order-1",
          location_id: "location-1",
          reference_id: "sage-ar-invoice:123",
          total_money: { amount: 704004, currency: "USD" },
          service_charges: [
            {
              uid: "hps-credit-card-fee",
              name: "Credit card fee (2%)",
            },
          ],
        },
        "DEBIT"
      )
    ).toThrow("unexpectedly contains a service charge")
  })

  it("checks Square's reported card funding type after payment", () => {
    const payment = {
      id: "payment-1",
      order_id: "order-1",
      location_id: "location-1",
      status: "COMPLETED",
      created_at: "2026-09-21T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:01.000Z",
      source_type: "CARD",
      amount_money: { amount: 10200, currency: "USD" },
      total_money: { amount: 10200, currency: "USD" },
      card_details: {
        card: { card_type: "CREDIT", prepaid_type: "NOT_PREPAID" },
      },
    }
    expect(() =>
      validateSquarePaymentFundingType(payment, "CREDIT")
    ).not.toThrow()
    expect(() =>
      validateSquarePaymentFundingType(
        {
          ...payment,
          card_details: {
            card: { card_type: "DEBIT", prepaid_type: "NOT_PREPAID" },
          },
        },
        "CREDIT"
      )
    ).toThrow("refund the 2% fee")
    expect(() =>
      validateSquarePaymentFundingType(
        {
          ...payment,
          card_details: {
            card: { card_type: "DEBIT", prepaid_type: "PREPAID" },
          },
        },
        "DEBIT"
      )
    ).toThrow("prepaid")
    expect(() =>
      validateSquarePaymentFundingType(
        { ...payment, source_type: "BANK_ACCOUNT", card_details: undefined },
        "ACH"
      )
    ).not.toThrow()
  })

  it("uses stable Sage invoice and Square payment identities in Compass", () => {
    expect(squareOwnerReceivableIds("401", "payment-1")).toEqual({
      invoiceId: "sage-square-invoice-401",
      paymentId: "sage-square-payment-payment-1",
      allocationId: "sage-square-allocation-401-payment-1",
      invoiceOperationId: "sage-square-owner-invoice-401",
      paymentOperationId: "sage-square-owner-payment-payment-1",
    })
  })

  it("stops when Square fee returns exceed assessed fees", () => {
    expect(() =>
      squareProcessingFeeExpenseCents([
        { amount_money: { amount: -25, currency: "USD" } },
      ])
    ).toThrow("returns exceed assessed fees")
  })

  it("gives admins the supported Sage external-receipt posting instructions", () => {
    expect(
      manualReceiptNotificationBody({
        organizationId: "org-1",
        projectId: "project-1",
        operationId: "operation-1",
        squarePaymentId: "payment-1",
        sageInvoiceNumber: "H-403-4378",
        department: "HPS",
        ownerPaymentCents: 690200,
        clientPaidFeeCents: 0,
        depositAccountNumber: 10000,
        merchantFeeAccountNumber: 62020,
      })
    ).toBe(
      "Square received $6,902.00 for Sage invoice H-403-4378 (HPS). " +
        "In Sage 3-3-2 Electronic Receipts, use Post—not Process and Post—apply $6,902.00 to this invoice, and use account 10000 — FSB Project Checking. " +
        "Compass is retaining the Square fee reconciliation for account 62020 — Merchant Service Fees. This is a posting step, not a second payment approval."
    )
  })

  it("gives separate Sage instructions for a client-paid credit fee", () => {
    expect(
      manualReceiptNotificationBody({
        organizationId: "org-1",
        projectId: "project-1",
        operationId: "operation-1",
        squarePaymentId: "payment-1",
        sageInvoiceNumber: "H-403-4378",
        department: "HPS",
        ownerPaymentCents: 690200,
        clientPaidFeeCents: 13804,
        depositAccountNumber: 10000,
        merchantFeeAccountNumber: 62020,
      })
    ).toContain(
      "$7,040.04 for Sage invoice H-403-4378 (HPS): $6,902.00 invoice principal plus a $138.04 client-paid credit card fee."
    )
  })
})
