import { describe, expect, it } from "vitest"

import {
  buildProjectEmailRecipientOptions,
  isValidRecipientEmail,
  normalizeRecipientEmail,
} from "@/lib/email/recipient-options"

describe("project email recipient options", () => {
  it("groups project contacts and preserves multiple people at one vendor", () => {
    const options = buildProjectEmailRecipientOptions([
      {
        id: "vendor-1",
        contactType: "supplier",
        displayName: "Morgan Buyer",
        companyName: "Timber Supply",
        email: "morgan@timber.example",
      },
      {
        id: "vendor-2",
        contactType: "supplier",
        displayName: "Riley Dispatch",
        companyName: "Timber Supply",
        email: "riley@timber.example",
      },
      {
        id: "client-1",
        contactType: "owner",
        displayName: "Casey Client",
        companyName: null,
        email: "casey@example.com",
      },
      {
        id: "staff-1",
        contactType: "internal",
        displayName: "Sam Superintendent",
        companyName: null,
        email: "sam@hps-colorado.com",
      },
    ])

    expect(options).toHaveLength(4)
    expect(options.map((option) => option.category)).toEqual([
      "vendor",
      "vendor",
      "client",
      "internal",
    ])
    expect(options.filter((option) => option.companyName === "Timber Supply"))
      .toHaveLength(2)
  })

  it("deduplicates normalized addresses and keeps the recommended identity", () => {
    const options = buildProjectEmailRecipientOptions(
      [
        {
          id: "duplicate",
          contactType: "internal",
          displayName: "Shared Inbox",
          companyName: null,
          email: " Orders@Example.com ",
        },
        {
          id: "preferred",
          contactType: "supplier",
          displayName: "Taylor Orders",
          companyName: "Acme Supply",
          email: "orders@example.com",
        },
      ],
      ["Acme Supply"]
    )

    expect(options).toEqual([
      {
        id: "preferred",
        email: "orders@example.com",
        displayName: "Taylor Orders",
        companyName: "Acme Supply",
        category: "vendor",
        recommended: true,
      },
    ])
  })

  it("normalizes and validates manually entered addresses", () => {
    expect(normalizeRecipientEmail(" New.Person@Example.com ")).toBe(
      "new.person@example.com"
    )
    expect(isValidRecipientEmail("new.person@example.com")).toBe(true)
    expect(isValidRecipientEmail("not-an-email")).toBe(false)
  })
})
