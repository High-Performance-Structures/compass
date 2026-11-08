import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

import { buildMatchDirectory, type DirectoryRows } from "@/lib/domain/conversations/participant-directory"
import {
  IDENTITY_KEY_SQL,
  compactCompanyName,
  identityFromKey,
  identityOfText,
  matchParticipant,
  parseParticipantText,
  suggestVendorForDomain,
  type MatchResult,
  type ParticipantIdentity,
} from "@/lib/domain/conversations/participant-matching"

/*
 * The matcher for unresolved imported participants: one identity per text,
 * staff first, one person per address, vendors by business domain, never by
 * free mail, and a name-that-reads-like-the-domain only as a suggestion.
 */

const EMPTY: DirectoryRows = { staff: [], internal: [], alternates: [], vendors: [], vendorPeople: [], clientPeople: [], projectContacts: [], companyDomains: [] }

const contact = (id: string, projectId: string, name: string, email: string | null, links: Partial<DirectoryRows["projectContacts"][number]> = {}): DirectoryRows["projectContacts"][number] => ({
  id, projectId, name, email, phone: null, contactType: "subcontractor", vendorId: null, customerId: null, vendorContactId: null,
  customerContactId: null, internalContactId: null, sourceEntityType: "manual", sourceEntityId: null, active: true, ...links,
})

/** A small company: staff Dan (old domain address is also a vendor contact's), vendors, clients and per-project rows. */
function rows(overrides: Partial<DirectoryRows> = {}): DirectoryRows {
  return {
    ...EMPTY,
    staff: [
      { userId: "u-dan", email: "dan@new.example", name: "Dan Vogel", active: true, phone: null },
      { userId: "u-cass", email: "cassandra@new.example", name: "Cassandra Vance", active: true, phone: null },
    ],
    internal: [{ id: "ic-dan", userId: "u-dan", name: "Dan Vogel", email: "dan@new.example", active: true, phone: null }],
    vendors: [
      { id: "v-hps-sub", name: "Our Own Subcontractor", email: null, primaryEmail: null },
      { id: "v-flat", name: "Flatiron Steel, Inc.", email: null, primaryEmail: null },
      { id: "v-bldr", name: "Builders Supply LLC", email: "orders@bldr.example", primaryEmail: null },
      { id: "v-gmail", name: "Gmail Framing", email: "framer@gmail.com", primaryEmail: null },
    ],
    vendorPeople: [
      // The company's own old address also sits on a vendor contact.
      { id: "vc-dan-old", vendorId: "v-hps-sub", vendorName: "Our Own Subcontractor", name: "Dan Vogel", email: "dan@old.example", userId: null, active: true, phone: null },
      { id: "vc-aaron", vendorId: "v-bldr", vendorName: "Builders Supply LLC", name: "Aaron Southard", email: "aaron@bldr.example", userId: null, active: true, phone: null },
    ],
    clientPeople: [{ id: "cc-louise", customerId: "cust-1", customerName: "Mountain Mutual", name: "Louise Noble", email: "gm@mutual.example", userId: null, active: true, phone: null }],
    projectContacts: [
      // One person, one row per project.
      contact("pc-louise-a", "p-a", "Louise Noble", "gm@mutual.example", { customerContactId: "cc-louise", customerId: "cust-1", contactType: "owner" }),
      contact("pc-louise-b", "p-b", "Louise Noble", "GM@Mutual.example", { customerContactId: "cc-louise", customerId: "cust-1", contactType: "owner" }),
      contact("pc-aaron-a", "p-a", "Aaron Southard", "aaron@bldr.example", { vendorContactId: "vc-aaron", vendorId: "v-bldr" }),
      contact("pc-aaron-b", "p-b", "Aaron Southard", "aaron@bldr.example"),
      // Two rows with the same name and email on one project, not linked to the directory.
      contact("pc-travis-1", "p-a", "Travis Loomis", "travis@gmail.com", { contactType: "owner" }),
      contact("pc-travis-2", "p-a", "Travis  Loomis", "travis@gmail.com", { contactType: "owner" }),
      // Two different people with the same name.
      contact("pc-pat-1", "p-a", "Pat Lee", "pat@one.example"),
      contact("pc-pat-2", "p-a", "Pat Lee", "pat@two.example"),
      // A staff member's own project row.
      contact("pc-cass", "p-a", "Cassandra Vance", "cassandra@old.example", { contactType: "internal", sourceEntityType: "user", sourceEntityId: "u-cass" }),
    ],
    ...overrides,
  }
}

function match(text: string, input: DirectoryRows = rows(), projectId = "p-a"): MatchResult {
  const identity = identityOfText(text)
  if (!identity) throw new Error(`no identity for ${text}`)
  return matchParticipant(buildMatchDirectory(input).directory, identity, projectId)
}

describe("reading the text", () => {
  it("parses Name <email>, a bare address, and a name", () => {
    expect(parseParticipantText("Louise Noble <GM@Mutual.example>")).toEqual({ name: "Louise Noble", email: "gm@mutual.example" })
    expect(parseParticipantText(" dan@old.example ")).toEqual({ name: null, email: "dan@old.example" })
    expect(parseParticipantText("Keith and  Jennifer Hinson")).toEqual({ name: "Keith and Jennifer Hinson", email: null })
    expect(identityOfText("Louise Noble <gm@mutual.example>")).toMatchObject({ kind: "email", key: "email:gm@mutual.example", local: "gm", domain: "mutual.example" })
    expect(identityOfText("LaCasse,  Steven")).toEqual({ kind: "name", key: "name:lacasse, steven", name: "lacasse, steven" })
    expect(identityFromKey("literal:a; b")).toBeNull()
  })

  it("keys rows in SQL exactly as the matcher reads the text", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec("CREATE TABLE project_source_record_participants (source_participant_id TEXT, source_contact_name TEXT, identity_status TEXT)")
    const cases: readonly [string, string | null, string, string][] = [
      ["unknown:email:dan@old.example", "dan@old.example", "unmatched", "email:dan@old.example"],
      ["internal:9421466", "Louise Noble <GM@mutual.example>", "unmatched", "email:gm@mutual.example"],
      ["internal:9421466", "Aaron@bldr.example", "unmatched", "email:aaron@bldr.example"],
      ["owner:35400646", "Travis  Loomis", "unmatched", "name:travis loomis"],
      ["unknown:name:pat lee", null, "unmatched", "name:pat lee"],
      ["to:owner:literal:abc", "Jane; Bob", "boundary_unproven:none", "literal:Jane; Bob"],
      // Nested or listed addresses are not one address: the whole text is the name.
      ["owner:2", "Lorenz, Kai <Kai Lorenz <kai@gmail.com>>", "unmatched", "name:lorenz, kai <kai lorenz <kai@gmail.com>>"],
    ]
    for (const [key, name, status, expected] of cases) {
      sqlite.prepare("DELETE FROM project_source_record_participants").run()
      sqlite.prepare("INSERT INTO project_source_record_participants VALUES (?, ?, ?)").run(key, name, status)
      const row: unknown = sqlite.prepare(`SELECT ${IDENTITY_KEY_SQL} AS k FROM project_source_record_participants p`).get()
      expect(row).toEqual({ k: expected })
      if (name && !expected.startsWith("literal:")) expect(identityOfText(name)?.key).toBe(expected)
    }
  })
})

describe("matching", () => {
  it("collapses one person's many project rows by the same email", () => {
    expect(match("gm@mutual.example", rows(), "p-c")).toMatchObject({ kind: "person", matchType: "same_email", ref: "customer_contact:cc-louise" })
    expect(match("Aaron Southard <aaron@bldr.example>", rows(), "p-b")).toMatchObject({ kind: "person", matchType: "same_email", ref: "vendor_contact:vc-aaron" })
    // No directory person: the project's own row, collapsed by address.
    expect(match("travis@gmail.com")).toMatchObject({ kind: "person", matchType: "same_email", ref: "project_contact:pc-travis-1" })
  })

  it("collapses a name only when the rows share an email or a directory person", () => {
    expect(match("Travis Loomis")).toMatchObject({ kind: "person", matchType: "same_name", ref: "project_contact:pc-travis-1" })
    expect(match("Louise Noble", rows(), "p-b")).toMatchObject({ kind: "person", matchType: "same_name", ref: "customer_contact:cc-louise" })
    expect(match("Pat Lee")).toEqual({ kind: "none", reason: "several_people", suggestion: null })
  })

  it("gives staff precedence over a vendor contact with the same address", () => {
    // Without the other address, the old address is only a vendor contact's.
    expect(match("dan@old.example")).toMatchObject({ kind: "person", ref: "vendor_contact:vc-dan-old" })
    // With it listed as Dan's other email address, Dan wins.
    expect(match("dan@old.example", rows({ alternates: [{ userId: "u-dan", email: "dan@old.example" }] })))
      .toMatchObject({ kind: "person", matchType: "staff_other_email", ref: "internal:ic-dan", staff: true })
    // With the old domain listed as a company domain, the same name before the @ wins.
    expect(match("dan@old.example", rows({ companyDomains: ["old.example", "new.example"] })))
      .toMatchObject({ kind: "person", matchType: "staff_company_domain", ref: "internal:ic-dan" })
    // A shared mailbox on a company domain is nobody, and never the vendor.
    expect(match("accounting@old.example", rows({ companyDomains: ["old.example"] }))).toMatchObject({ kind: "none", reason: "company_mailbox" })
    expect(match("dan@new.example")).toMatchObject({ kind: "person", matchType: "staff_email", ref: "internal:ic-dan" })
    // A staff member's own project row is that staff member.
    expect(match("cassandra@old.example")).toMatchObject({ kind: "person", matchType: "staff_email", ref: "user:u-cass" })
    expect(match("Cassandra Vance")).toMatchObject({ kind: "person", matchType: "staff_name", ref: "user:u-cass" })
  })

  it("matches a business domain to its one vendor, never free mail or a staff domain", () => {
    expect(match("Dawn Wheeler <dawn@bldr.example>")).toEqual({ kind: "vendor", matchType: "vendor_domain", vendorId: "v-bldr", vendorName: "Builders Supply LLC" })
    expect(match("someone@gmail.com")).toEqual({ kind: "none", reason: "no_match", suggestion: null })
    // A domain only staff use is the company's own even before Settings lists it.
    expect(match("nancy@new.example")).toMatchObject({ kind: "none", reason: "company_mailbox" })
    const twoVendors = rows({ vendors: [...rows().vendors, { id: "v-bldr-2", name: "Builders Supply North", email: "north@bldr.example", primaryEmail: null }] })
    expect(match("dawn@bldr.example", twoVendors)).toMatchObject({ kind: "none", reason: "several_vendors" })
  })

  it("only suggests a vendor whose name reads like the domain", () => {
    expect(match("ordercs@flatironsteel.com")).toEqual({ kind: "none", reason: "no_match", suggestion: { vendorId: "v-flat", vendorName: "Flatiron Steel, Inc." } })
    expect(compactCompanyName("Flatiron Steel, Inc.")).toBe("flatironsteel")
    expect(suggestVendorForDomain("gmail.com", [{ id: "g", name: "Gmail", emails: [] }])).toBeNull()
    expect(suggestVendorForDomain("orders.flatironsteel.com", [{ id: "v", name: "Flatiron Steel Co", emails: [] }])).toEqual({ vendorId: "v", vendorName: "Flatiron Steel Co" })
  })

  it("finds nobody for an unknown name", () => {
    const identity: ParticipantIdentity = { kind: "name", key: "name:nobody here", name: "nobody here" }
    expect(matchParticipant(buildMatchDirectory(rows()).directory, identity, "p-a")).toEqual({ kind: "none", reason: "no_match", suggestion: null })
  })
})
