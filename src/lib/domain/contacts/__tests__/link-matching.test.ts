import { describe, expect, it } from "vitest"

import {
  buildLinkReport,
  directoryKindsForContactType,
  proposeDirectoryLink,
  type DirectoryCandidate,
  type LinkSubject,
} from "../link-matching"

function candidate(overrides: Partial<DirectoryCandidate>): DirectoryCandidate {
  return {
    kind: "vendor",
    id: "vendor-1",
    organizationId: "org-1",
    name: "Acme Framing",
    company: "Acme Framing",
    email: null,
    ...overrides,
  }
}

function subject(overrides: Partial<LinkSubject>): LinkSubject {
  return {
    id: "pc-1",
    organizationId: "org-1",
    name: "Acme Framing",
    company: "Acme Framing",
    email: null,
    kinds: directoryKindsForContactType("subcontractor"),
    compareCompany: true,
    ...overrides,
  }
}

describe("proposeDirectoryLink", () => {
  it("matches by normalized email first", () => {
    const result = proposeDirectoryLink(subject({ name: "Someone else", email: " Office@Acme.com " }), [
      candidate({ email: "office@acme.com" }),
      candidate({ id: "vendor-2", name: "Someone else", company: "Acme Framing" }),
    ])
    expect(result).toMatchObject({ outcome: "exact", rule: "email", candidate: { id: "vendor-1" } })
  })

  it("never guesses between several email matches", () => {
    const result = proposeDirectoryLink(subject({ email: "office@acme.com" }), [
      candidate({ email: "office@acme.com" }),
      candidate({ id: "person-1", kind: "vendor_contact", email: "OFFICE@acme.com" }),
    ])
    expect(result).toMatchObject({ outcome: "ambiguous", rule: "email" })
  })

  it("falls back to exact normalized name and company", () => {
    expect(proposeDirectoryLink(subject({ name: "ACME framing!", company: "acme  framing" }), [candidate({})])).toMatchObject({
      outcome: "exact",
      rule: "name_company",
    })
    expect(proposeDirectoryLink(subject({ company: "Other Co" }), [candidate({})])).toEqual({ outcome: "none" })
  })

  it("ignores other organizations and directories the contact type cannot use", () => {
    expect(
      proposeDirectoryLink(subject({}), [
        candidate({ organizationId: "org-2" }),
        candidate({ id: "customer-1", kind: "customer" }),
      ])
    ).toEqual({ outcome: "none" })
    expect(directoryKindsForContactType("owner")).toEqual(["customer", "customer_contact"])
    expect(directoryKindsForContactType("internal")).toEqual(["internal_contact"])
    expect(directoryKindsForContactType("unknown")).toEqual([])
  })

  it("matches a project client name on name alone", () => {
    const client = subject({ name: "Pat Owner", company: null, kinds: ["customer"], compareCompany: false })
    expect(
      proposeDirectoryLink(client, [candidate({ kind: "customer", id: "customer-1", name: "pat owner", company: "Owner LLC" })])
    ).toMatchObject({ outcome: "exact", candidate: { id: "customer-1" } })
  })
})

describe("buildLinkReport", () => {
  it("counts exact, ambiguous and unmatched proposals", () => {
    const report = buildLinkReport(
      [
        subject({ id: "email", email: "a@acme.com" }),
        subject({ id: "name" }),
        subject({ id: "ambiguous", name: "Twin", company: "Twin" }),
        subject({ id: "none", name: "Nobody", company: null }),
      ],
      [
        candidate({ id: "v-email", name: "X", company: "X", email: "a@acme.com" }),
        candidate({ id: "v-name" }),
        candidate({ id: "twin-1", name: "Twin", company: "Twin" }),
        candidate({ id: "twin-2", name: "Twin", company: "Twin" }),
      ]
    )
    expect(report.counts).toEqual({ total: 4, exactByEmail: 1, exactByNameCompany: 1, ambiguous: 1, noMatch: 1 })
  })
})
