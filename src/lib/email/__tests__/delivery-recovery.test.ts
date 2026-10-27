import { describe, expect, it } from "vitest"
import { emailRetryAt, invitationEmailNotice, isEmailRateLimit } from "../delivery-recovery"
const now = new Date("2026-10-27T00:00:00.000Z")
describe("email retry policy", () => {
  it("honors both the retry timestamp and Retry-After header", () => {
    expect(emailRetryAt({ now, attempt: 0, error: "Retry after 2026-10-27T00:15:37.014Z", retryAfter: "1200" })).toBe("2026-10-27T00:20:05.000Z")
    expect(emailRetryAt({ now, attempt: 0, error: null, retryAfter: "Tue, 27 Oct 2026 01:00:00 GMT" })).toBe("2026-10-27T01:00:05.000Z")
  })
  it("backs off when the provider gives no usable retry time", () => {
    expect(emailRetryAt({ now, attempt: 2, error: null, retryAfter: "invalid" })).toBe("2026-10-27T00:04:00.000Z")
  })
  it("only classifies known rejection codes as rate limits", () => {
    expect(isEmailRateLimit(429, "")).toBe(true)
    expect(isEmailRateLimit(403, '{"reason":"userRateLimitExceeded"}')).toBe(true)
    expect(isEmailRateLimit(403, '{"reason":"forbidden"}')).toBe(false)
    expect(isEmailRateLimit(500, "")).toBe(false)
  })
  it("distinguishes queued, failed, uncertain, and sent mail in staff feedback", () => {
    expect(invitationEmailNotice("sent", null)).toBeNull()
    expect(invitationEmailNotice("retrying", now.toISOString())).toContain("retry automatically")
    expect(invitationEmailNotice("failed", null)).toContain("failed")
    expect(invitationEmailNotice("unknown", null)).toContain("before resending")
  })
})
