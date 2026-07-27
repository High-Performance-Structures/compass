import { describe, expect, it } from "vitest"

import {
  hasCurrentSmsConsent,
  SMS_OPT_IN_DISCLOSURE_VERSION,
} from "@/lib/notifications/sms-consent"

describe("hasCurrentSmsConsent", () => {
  it("accepts consent only for the saved phone and current disclosure", () => {
    expect(
      hasCurrentSmsConsent({
        accepted: true,
        phoneNumber: " (719) 555-0123 ",
        consentPhoneNumber: "(719) 555-0123",
        disclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
      })
    ).toBe(true)
  })

  it("rejects missing, stale, or phone-mismatched consent", () => {
    expect(
      hasCurrentSmsConsent({
        accepted: false,
        phoneNumber: "(719) 555-0123",
        consentPhoneNumber: "(719) 555-0123",
        disclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
      })
    ).toBe(false)
    expect(
      hasCurrentSmsConsent({
        accepted: true,
        phoneNumber: "(719) 555-0123",
        consentPhoneNumber: "(719) 555-9999",
        disclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
      })
    ).toBe(false)
    expect(
      hasCurrentSmsConsent({
        accepted: true,
        phoneNumber: "(719) 555-0123",
        consentPhoneNumber: "(719) 555-0123",
        disclosureVersion: "stale",
      })
    ).toBe(false)
  })
})
