import { describe, expect, it } from "vitest"
import { projectReplyAddressHasToken, validateProjectEmailAudience } from "../project-email-validation"

describe("project email audience", () => {
  it("normalizes addresses and preserves visible and blind recipient classes", () => {
    expect(validateProjectEmailAudience({ to: [" A@Example.com "], cc: ["B@example.com"], bcc: ["C@example.com"] }))
      .toEqual({ success: true, data: { to: ["a@example.com"], cc: ["b@example.com"], bcc: ["c@example.com"] } })
  })
  it("rejects duplicates across To, Cc and Bcc", () => {
    expect(validateProjectEmailAudience({ to: ["a@example.com"], cc: [], bcc: ["A@example.com"] }).success).toBe(false)
  })
  it("requires a To address and limits mass email recipients", () => {
    expect(validateProjectEmailAudience({ to: [], cc: ["a@example.com"], bcc: [] }).success).toBe(false)
    expect(validateProjectEmailAudience({ to: Array.from({ length: 51 }, (_, index) => `p${index}@example.com`), cc: [], bcc: [] }).success).toBe(false)
  })
  it("rejects address-list and header syntax in manually entered addresses", () => {
    for (const email of ["a@example.com,b@example.com", "Name <a@example.com>", "a@example.com\r\nBcc: b@example.com"]) {
      expect(validateProjectEmailAudience({ to: [email], cc: [], bcc: [] }).success).toBe(false)
    }
  })
  it("requires the reply token in the actual destination address", () => {
    expect(projectReplyAddressHasToken("Compass <jarvis+cmp-0123456789abcdef12@example.com>", "cmp-0123456789abcdef12")).toBe(true)
    expect(projectReplyAddressHasToken("jarvis@example.com", "cmp-0123456789abcdef12")).toBe(false)
  })
})
