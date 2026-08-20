import { describe, expect, it } from "vitest"

import { isKnownInternalSmsSender } from "@/lib/goto/internal-sender"

const INTERNAL_CANDIDATES = [
  {
    role: "project_manager",
    profilePhone: "(719) 555-0123",
    smsPhoneNumber: null,
  },
  {
    role: "field_crew",
    profilePhone: null,
    smsPhoneNumber: "+17195550456",
  },
  {
    role: "client",
    profilePhone: "+17195550789",
    smsPhoneNumber: null,
  },
] as const

describe("known internal SMS senders", () => {
  it("matches active staff profile and notification phone formats", () => {
    expect(
      isKnownInternalSmsSender("+1 719-555-0123", INTERNAL_CANDIDATES)
    ).toBe(true)
    expect(
      isKnownInternalSmsSender("7195550456", INTERNAL_CANDIDATES)
    ).toBe(true)
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
