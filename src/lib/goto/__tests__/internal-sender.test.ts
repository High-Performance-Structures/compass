import { describe, expect, it } from "vitest"

import { isKnownInternalSmsSender } from "@/lib/goto/internal-sender"
import { SMS_OPT_IN_DISCLOSURE_VERSION } from "@/lib/notifications/sms-consent"

const INTERNAL_CANDIDATES = [
  {
    role: "project_manager",
    smsEnabled: true,
    smsPhoneNumber: "(719) 555-0123",
    smsConsentAccepted: true,
    smsConsentDisclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
    smsConsentPhoneNumber: "(719) 555-0123",
  },
  {
    role: "field_crew",
    smsEnabled: true,
    smsPhoneNumber: "+17195550456",
    smsConsentAccepted: true,
    smsConsentDisclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
    smsConsentPhoneNumber: "+17195550456",
  },
  {
    role: "client",
    smsEnabled: true,
    smsPhoneNumber: "+17195550789",
    smsConsentAccepted: true,
    smsConsentDisclosureVersion: SMS_OPT_IN_DISCLOSURE_VERSION,
    smsConsentPhoneNumber: "+17195550789",
  },
] as const

describe("known internal SMS senders", () => {
  it("matches consented staff SMS phone formats", () => {
    expect(
      isKnownInternalSmsSender("+1 719-555-0123", INTERNAL_CANDIDATES)
    ).toBe(true)
    expect(
      isKnownInternalSmsSender("7195550456", INTERNAL_CANDIDATES)
    ).toBe(true)
  })

  it("does not trust disabled, stale, or unconsented SMS numbers", () => {
    const candidate = INTERNAL_CANDIDATES[0]
    expect(
      isKnownInternalSmsSender("7195550123", [
        { ...candidate, smsEnabled: false },
      ])
    ).toBe(false)
    expect(
      isKnownInternalSmsSender("7195550123", [
        { ...candidate, smsConsentAccepted: false },
      ])
    ).toBe(false)
    expect(
      isKnownInternalSmsSender("7195550123", [
        { ...candidate, smsConsentPhoneNumber: "+17195550999" },
      ])
    ).toBe(false)
  })

  it("does not suppress external contacts or malformed phone numbers", () => {
    expect(
      isKnownInternalSmsSender("+17195550789", INTERNAL_CANDIDATES)
    ).toBe(false)
    expect(isKnownInternalSmsSender("555", INTERNAL_CANDIDATES)).toBe(false)
    expect(
      isKnownInternalSmsSender("+17195550999", INTERNAL_CANDIDATES)
    ).toBe(false)
  })
})
