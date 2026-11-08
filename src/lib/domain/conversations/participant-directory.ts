import type { DirectoryPerson } from "@/lib/domain/contacts/people-search"

import { isFreeMailDomain, type DirectoryEntry, type DirectoryVendor, type MatchDirectory } from "./participant-matching"

/*
 * Builds the matcher's view of a company's directory from plain rows. Pure:
 * the server reads the rows with Drizzle, the read-only dry-run script with
 * wrangler, and both build the same directory here.
 */

export type DirectoryRows = {
  /** Staff accounts of the company (organization members with a staff role). */
  readonly staff: readonly { readonly userId: string; readonly email: string | null; readonly name: string | null; readonly active: boolean; readonly phone: string | null }[]
  readonly internal: readonly { readonly id: string; readonly userId: string | null; readonly name: string; readonly email: string | null; readonly active: boolean; readonly phone: string | null }[]
  readonly alternates: readonly { readonly userId: string; readonly email: string }[]
  readonly vendors: readonly { readonly id: string; readonly name: string; readonly email: string | null; readonly primaryEmail: string | null }[]
  readonly vendorPeople: readonly { readonly id: string; readonly vendorId: string; readonly vendorName: string; readonly name: string; readonly email: string | null; readonly userId: string | null; readonly active: boolean; readonly phone: string | null }[]
  readonly clientPeople: readonly { readonly id: string; readonly customerId: string; readonly customerName: string; readonly name: string; readonly email: string | null; readonly userId: string | null; readonly active: boolean; readonly phone: string | null }[]
  readonly projectContacts: readonly {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly email: string | null
    readonly phone: string | null
    readonly contactType: string
    readonly vendorId: string | null
    readonly customerId: string | null
    readonly vendorContactId: string | null
    readonly customerContactId: string | null
    readonly internalContactId: string | null
    readonly sourceEntityType: string | null
    readonly sourceEntityId: string | null
    readonly active: boolean
  }[]
  readonly companyDomains: readonly string[]
}

export type BuiltDirectory = {
  readonly directory: MatchDirectory
  /** The person a decision resolves to, by reference. */
  readonly people: ReadonlyMap<string, DirectoryPerson>
  /** Existing project contacts by `<projectId>|<link type>|<directory id>` (active first). */
  readonly known: ReadonlyMap<string, string>
}

const NEW_PERSON_SOURCE = "buildertrend_new_person"

const address = (value: string | null | undefined): string | null => {
  const email = value?.trim().toLowerCase() ?? ""
  return email.includes("@") ? email : null
}

const unique = (values: readonly (string | null)[]): readonly string[] => [...new Set(values.filter((value): value is string => value !== null))]

const blankPerson = { userId: null, vendorId: null, customerId: null, projectId: null, contactType: null, sourceEntityId: null, unassigned: false } as const

export function buildMatchDirectory(rows: DirectoryRows): BuiltDirectory {
  const entries: DirectoryEntry[] = []
  const people = new Map<string, DirectoryPerson>()
  const otherByUser = new Map<string, string[]>()
  for (const row of rows.alternates) {
    const email = address(row.email)
    if (email) otherByUser.set(row.userId, [...(otherByUser.get(row.userId) ?? []), email])
  }
  const staffById = new Map(rows.staff.map((row) => [row.userId, row]))
  const usersWithContact = new Set(rows.internal.flatMap((row) => (row.userId && staffById.has(row.userId) ? [row.userId] : [])))

  const link = { internalContactId: null, vendorContactId: null, customerContactId: null, vendorId: null, customerId: null, projectId: null, unassigned: false } as const

  // A staff account with an internal contact is that contact (as people-search lists it).
  for (const row of rows.internal) {
    const account = row.userId ? staffById.get(row.userId) : undefined
    const other = row.userId ? otherByUser.get(row.userId) ?? [] : []
    const ref = `internal:${row.id}`
    entries.push({
      ...link, ref, type: "internal", name: row.name,
      emails: unique([address(row.email), address(account?.email), ...other]), otherEmails: other,
      staff: account !== undefined, active: row.active, userId: account ? row.userId : null, internalContactId: row.id,
    })
    people.set(ref, { ...blankPerson, ref, type: "internal", id: row.id, name: row.name, label: row.active ? "Staff" : "Archived staff", email: row.email, phone: row.phone, active: row.active, userId: account ? row.userId : null })
  }
  for (const row of rows.staff) {
    if (usersWithContact.has(row.userId)) continue
    const other = otherByUser.get(row.userId) ?? []
    const ref = `user:${row.userId}`
    const name = row.name ?? row.email ?? row.userId
    entries.push({ ...link, ref, type: "user", name, emails: unique([address(row.email), ...other]), otherEmails: other, staff: true, active: row.active, userId: row.userId })
    people.set(ref, { ...blankPerson, ref, type: "user", id: row.userId, name, label: row.active ? "Staff" : "Archived staff", email: row.email, phone: row.phone, active: row.active, userId: row.userId })
  }
  for (const row of rows.vendorPeople) {
    const ref = `vendor_contact:${row.id}`
    entries.push({ ...link, ref, type: "vendor_contact", name: row.name, emails: unique([address(row.email)]), otherEmails: [], staff: false, active: row.active, userId: row.userId, vendorContactId: row.id, vendorId: row.vendorId })
    people.set(ref, { ...blankPerson, ref, type: "vendor_contact", id: row.id, name: row.name, label: `Vendor: ${row.vendorName}`, email: row.email, phone: row.phone, active: row.active, userId: row.userId, vendorId: row.vendorId })
  }
  for (const row of rows.clientPeople) {
    const ref = `customer_contact:${row.id}`
    entries.push({ ...link, ref, type: "customer_contact", name: row.name, emails: unique([address(row.email)]), otherEmails: [], staff: false, active: row.active, userId: row.userId, customerContactId: row.id, customerId: row.customerId })
    people.set(ref, { ...blankPerson, ref, type: "customer_contact", id: row.id, name: row.name, label: `Client: ${row.customerName}`, email: row.email, phone: row.phone, active: row.active, userId: row.userId, customerId: row.customerId })
  }

  const known = new Map<string, string>()
  // Active rows first, then by id: the same order the single review reads them in.
  const contacts = [...rows.projectContacts].sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id))
  for (const row of contacts) {
    const ref = `project_contact:${row.id}`
    const unassigned = row.sourceEntityType === NEW_PERSON_SOURCE && !row.vendorId && !row.customerId
    // A staff row added from an account is that account.
    const userId = row.sourceEntityType === "user" ? row.sourceEntityId : null
    entries.push({
      ref, type: "project_contact", name: row.name, emails: unique([address(row.email)]), otherEmails: [], staff: false, active: row.active,
      userId, internalContactId: row.internalContactId, vendorContactId: row.vendorContactId, customerContactId: row.customerContactId,
      vendorId: row.vendorId, customerId: row.customerId, projectId: row.projectId, unassigned,
    })
    people.set(ref, {
      ...blankPerson, ref, type: "project_contact", id: row.id, name: row.name, label: unassigned ? "Unassigned" : "Project contact",
      email: row.email, phone: row.phone, active: row.active, projectId: row.projectId, contactType: row.contactType, sourceEntityId: row.sourceEntityId, unassigned,
    })
    for (const [type, id] of [["internal", row.internalContactId], ["vendor_contact", row.vendorContactId], ["customer_contact", row.customerContactId]] as const) {
      const key = id ? `${row.projectId}|${type}|${id}` : null
      if (key && !known.has(key)) known.set(key, row.id)
    }
  }

  const peopleEmails = new Map<string, string[]>()
  for (const row of rows.vendorPeople) {
    const email = address(row.email)
    if (email) peopleEmails.set(row.vendorId, [...(peopleEmails.get(row.vendorId) ?? []), email])
  }
  const vendors: DirectoryVendor[] = rows.vendors.map((row) => ({
    id: row.id, name: row.name,
    emails: unique([address(row.email), address(row.primaryEmail), ...(peopleEmails.get(row.id) ?? [])]),
  }))

  const companyDomains = unique(rows.companyDomains.map((domain) => domain.trim().toLowerCase() || null)).filter((domain) => !isFreeMailDomain(domain))
  return { directory: { entries, vendors, companyDomains }, people, known }
}
