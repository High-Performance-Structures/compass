import { describe, expect, it } from "vitest"

import {
  sameTrustedInternalEmailMailbox,
  trustedInternalEmailDomains,
} from "@/lib/email/internal-email-alias"

describe("internal email aliases", () => {
  const trustedDomains = trustedInternalEmailDomains({})

  it("recognizes the same staff mailbox across trusted company domains", () => {
    expect(
      sameTrustedInternalEmailMailbox({
        senderEmail: "martine@openrangeconstruction.com",
        memberEmail: "martine@hps-colorado.com",
        trustedDomains,
      })
    ).toBe(true)
  })

  it("does not match a different local mailbox", () => {
    expect(
      sameTrustedInternalEmailMailbox({
        senderEmail: "someone-else@openrangeconstruction.com",
        memberEmail: "martine@hps-colorado.com",
        trustedDomains,
      })
    ).toBe(false)
  })

  it("does not trust a matching mailbox on an external domain", () => {
    expect(
      sameTrustedInternalEmailMailbox({
        senderEmail: "martine@example.com",
        memberEmail: "martine@hps-colorado.com",
        trustedDomains,
      })
    ).toBe(false)
  })

  it("supports additional configured company domains", () => {
    const configuredDomains = trustedInternalEmailDomains({
      COMPASS_INTERNAL_EMAIL_DOMAINS: "design.example, nu-tech.example",
    })
    expect(
      sameTrustedInternalEmailMailbox({
        senderEmail: "staff@design.example",
        memberEmail: "staff@nu-tech.example",
        trustedDomains: configuredDomains,
      })
    ).toBe(true)
  })
})
