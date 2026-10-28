import { describe, expect, it } from "vitest"

import { hashQuoteLinkToken, isQuoteLinkTokenShape, newQuoteLinkToken, quoteLinkExpiresAt, quoteLinkIsLive } from "@/lib/rfqs/quote-links"
import { checkRfqVendorAnswer } from "@/lib/rfqs/vendor-response"

const day = 24 * 60 * 60 * 1000

describe("RFQ price links", () => {
  it("makes unguessable tokens and stores only a hash", async () => {
    const token = newQuoteLinkToken()
    expect(isQuoteLinkTokenShape(token)).toBe(true)
    expect(newQuoteLinkToken()).not.toBe(token)
    const hash = await hashQuoteLinkToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(await hashQuoteLinkToken(token)).toBe(hash)
    expect(isQuoteLinkTokenShape("short")).toBe(false)
    expect(isQuoteLinkTokenShape(`${token.slice(0, 42)}!`)).toBe(false)
  })

  it("expires after the due date plus grace, or a set time without a due date", () => {
    const now = new Date("2026-10-27T12:00:00Z")
    expect(quoteLinkExpiresAt({ now, dueDate: "2026-11-07", graceDays: 14, daysWithoutDueDate: 45 })).toBe("2026-11-21T23:59:59.000Z")
    expect(quoteLinkExpiresAt({ now, dueDate: null, graceDays: 14, daysWithoutDueDate: 45 })).toBe(new Date(now.getTime() + 45 * day).toISOString())
    // A due date in the past still leaves the grace period from today.
    expect(quoteLinkExpiresAt({ now, dueDate: "2026-01-01", graceDays: 14, daysWithoutDueDate: 45 })).toBe(new Date(now.getTime() + 14 * day).toISOString())
  })

  it("stops working when turned off or expired", () => {
    const now = new Date("2026-10-27T12:00:00Z")
    expect(quoteLinkIsLive({ expiresAt: "2026-11-01T00:00:00Z", revokedAt: null }, now)).toBe(true)
    expect(quoteLinkIsLive({ expiresAt: "2026-11-01T00:00:00Z", revokedAt: "2026-10-27T00:00:00Z" }, now)).toBe(false)
    expect(quoteLinkIsLive({ expiresAt: "2026-10-01T00:00:00Z", revokedAt: null }, now)).toBe(false)
  })
})

describe("vendor answers", () => {
  const payload = { scopeItems: [{ lineNumber: 1, description: "Electrical", phaseCode: "16", costCode: "16.100", notes: null }, { lineNumber: 2, description: "Low voltage", phaseCode: "16", costCode: "16.400", notes: null }] }

  it("totals the line prices", () => {
    const answer = checkRfqVendorAnswer(payload, {
      decision: "quote",
      amount: 1,
      lines: [{ lineNumber: 1, amount: 41250, notes: null }, { lineNumber: 2, amount: 5650.004, notes: " " }],
      leadTime: " 3 weeks ",
      validUntil: "2026-12-31",
      notes: null,
    })
    expect(answer).toMatchObject({ ok: true, amount: 46900, response: { leadTime: "3 weeks", validUntil: "2026-12-31", lines: [{ amount: 41250 }, { amount: 5650, notes: null }] } })
  })

  it("needs a price for every line", () => {
    const answer = checkRfqVendorAnswer(payload, { decision: "quote", amount: null, lines: [{ lineNumber: 1, amount: 100, notes: null }], leadTime: null, validUntil: null, notes: null })
    expect(answer).toEqual({ ok: false, error: "Enter a valid price for every RFQ scope line." })
  })

  it("accepts a decline without prices and rejects bad dates", () => {
    expect(checkRfqVendorAnswer(payload, { decision: "decline", amount: null, lines: [], leadTime: null, validUntil: null, notes: "Too busy" })).toMatchObject({ ok: true, amount: null })
    expect(checkRfqVendorAnswer(payload, { decision: "decline", amount: null, lines: [], leadTime: null, validUntil: "12/31/2026", notes: null })).toEqual({ ok: false, error: "Valid until must be a valid date." })
  })
})
