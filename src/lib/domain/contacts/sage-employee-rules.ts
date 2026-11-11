/**
 * Pure rules for tying staff to their Sage employee record (no database or
 * network access here; architecture standard, section 1).
 *
 * Linking: an active staff member who is not yet linked (an internal contact
 * with no Sage employee id or number, or a staff login with no internal
 * contact at all) is linked to the one current Sage employee whose email
 * matches theirs, compared trimmed and case-insensitively. Names never link
 * anyone. A match is left for a person to decide ("needs linking") when:
 * - two current Sage employees share the email,
 * - two unlinked staff share the email,
 * - the Sage employee is already linked to another contact, or
 * - the only Sage employees with the email are not current.
 * A rehire whose old Sage record is inactive still links: only current Sage
 * employees are candidates.
 *
 * Status: a linked contact is active while its Sage employee is current
 * (status 1 and not inactive) and inactive otherwise. An employee missing
 * from the read changes nothing, so a short read never deactivates anyone.
 */
import { normalizeSageRecordId } from "@/lib/sage/record-id"

import { normalizeEmailKey } from "./rules"

export type SageEmployeeRecord = {
  readonly sageRecordId: string
  readonly sageEmployeeNumber: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string | null
  readonly sageStatusCode: number | null
  readonly inactive: boolean
}

/** A staff internal contact, with the email of the Compass user it belongs to. */
export type StaffContactRecord = {
  readonly internalContactId: string
  readonly userId: string | null
  readonly name: string
  readonly email: string | null
  readonly userEmail: string | null
  readonly active: boolean
  readonly sageEmployeeId: string | null
  readonly sageEmployeeNumber: string | null
}

/** An active staff login with no internal contact in the company. */
export type StaffUserRecord = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly phone: string | null
}

type StaffLinkTarget =
  | { readonly kind: "contact"; readonly internalContactId: string; readonly name: string }
  | { readonly kind: "user"; readonly user: StaffUserRecord }

export type SageEmployeeLink = {
  readonly target: StaffLinkTarget
  readonly employee: SageEmployeeRecord
}

/** Why an unlinked staff member was not linked automatically. */
export type SageEmployeeLinkGap =
  | "no_email"
  | "no_sage_match"
  | "sage_not_current"
  | "several_sage_employees"
  | "several_staff"
  | "sage_already_linked"

export type StaffNeedingSageLink = {
  readonly target: StaffLinkTarget
  readonly email: string | null
  readonly gap: SageEmployeeLinkGap
}

export type SageEmployeeStatusChange = {
  readonly internalContactId: string
  readonly name: string
  readonly active: boolean
  readonly employee: SageEmployeeRecord
}

export function sageEmployeeIsCurrent(employee: Pick<SageEmployeeRecord, "sageStatusCode" | "inactive">): boolean {
  return employee.sageStatusCode === 1 && !employee.inactive
}

export function sageEmployeeName(employee: Pick<SageEmployeeRecord, "firstName" | "lastName" | "sageEmployeeNumber">): string {
  const name = [employee.firstName, employee.lastName].map((part) => part?.trim() ?? "").filter(Boolean).join(" ")
  return name || `Sage employee ${employee.sageEmployeeNumber}`
}

function trimmed(value: string | null): string {
  return value?.trim() ?? ""
}

export function staffContactIsLinked(contact: Pick<StaffContactRecord, "sageEmployeeId" | "sageEmployeeNumber">): boolean {
  return trimmed(contact.sageEmployeeId) !== "" || trimmed(contact.sageEmployeeNumber) !== ""
}

function idKey(value: string): string {
  return normalizeSageRecordId(value.trim())
}

type Candidate = {
  readonly target: StaffLinkTarget
  readonly emails: readonly string[]
}

function candidatesFor(contacts: readonly StaffContactRecord[], users: readonly StaffUserRecord[]): readonly Candidate[] {
  const fromContacts = contacts
    .filter((contact) => contact.active && !staffContactIsLinked(contact))
    .map((contact): Candidate => ({
      target: { kind: "contact", internalContactId: contact.internalContactId, name: contact.name },
      emails: [...new Set([normalizeEmailKey(contact.email), normalizeEmailKey(contact.userEmail)].filter(Boolean))],
    }))
  const fromUsers = users.map((user): Candidate => ({
    target: { kind: "user", user },
    emails: [normalizeEmailKey(user.email)].filter(Boolean),
  }))
  return [...fromContacts, ...fromUsers]
}

/** Which unlinked staff link to which Sage employee by email, and who is left for a person to link. */
export function planSageEmployeeLinks(input: {
  readonly employees: readonly SageEmployeeRecord[]
  readonly contacts: readonly StaffContactRecord[]
  readonly usersWithoutContact: readonly StaffUserRecord[]
}): { readonly links: readonly SageEmployeeLink[]; readonly needsLinking: readonly StaffNeedingSageLink[] } {
  const linkedIds = new Set(input.contacts.map((contact) => trimmed(contact.sageEmployeeId)).filter(Boolean).map(idKey))
  const linkedNumbers = new Set(input.contacts.map((contact) => trimmed(contact.sageEmployeeNumber)).filter(Boolean))
  const employeesByEmail = new Map<string, SageEmployeeRecord[]>()
  for (const employee of input.employees) {
    const key = normalizeEmailKey(employee.email)
    if (!key) continue
    employeesByEmail.set(key, [...(employeesByEmail.get(key) ?? []), employee])
  }
  const candidates = candidatesFor(input.contacts, input.usersWithoutContact)
  const candidatesByEmail = new Map<string, number>()
  for (const candidate of candidates) {
    for (const email of candidate.emails) candidatesByEmail.set(email, (candidatesByEmail.get(email) ?? 0) + 1)
  }

  const links: SageEmployeeLink[] = []
  const needsLinking: StaffNeedingSageLink[] = []
  for (const candidate of candidates) {
    const email = candidate.emails[0] ?? null
    const gap = (value: SageEmployeeLinkGap): void => { needsLinking.push({ target: candidate.target, email, gap: value }) }
    if (candidate.emails.length === 0) { gap("no_email"); continue }
    const matches = [...new Map(candidate.emails
      .flatMap((key) => employeesByEmail.get(key) ?? [])
      .map((employee) => [idKey(employee.sageRecordId), employee])).values()]
    if (matches.length === 0) { gap("no_sage_match"); continue }
    const current = matches.filter(sageEmployeeIsCurrent)
    if (current.length === 0) { gap("sage_not_current"); continue }
    const [employee, ...others] = current
    if (!employee || others.length > 0) { gap("several_sage_employees"); continue }
    if (linkedIds.has(idKey(employee.sageRecordId)) || linkedNumbers.has(employee.sageEmployeeNumber)) {
      gap("sage_already_linked")
      continue
    }
    if ((candidatesByEmail.get(normalizeEmailKey(employee.email)) ?? 0) > 1) { gap("several_staff"); continue }
    links.push({ target: candidate.target, employee })
  }
  return { links, needsLinking }
}

/** Linked contacts whose active flag differs from their Sage employee's status. */
export function planSageEmployeeStatus(input: {
  readonly employees: readonly SageEmployeeRecord[]
  readonly contacts: readonly StaffContactRecord[]
}): readonly SageEmployeeStatusChange[] {
  const byId = new Map(input.employees.map((employee) => [idKey(employee.sageRecordId), employee]))
  const byNumber = new Map(input.employees.map((employee) => [employee.sageEmployeeNumber, employee]))
  const changes: SageEmployeeStatusChange[] = []
  for (const contact of input.contacts) {
    const id = trimmed(contact.sageEmployeeId)
    const number = trimmed(contact.sageEmployeeNumber)
    // A verified id decides; a number-only contact (an older import) uses its number.
    const employee = id ? byId.get(idKey(id)) : number ? byNumber.get(number) : undefined
    if (!employee) continue
    const active = sageEmployeeIsCurrent(employee)
    if (contact.active !== active) {
      changes.push({ internalContactId: contact.internalContactId, name: contact.name, active, employee })
    }
  }
  return changes
}

/** The internal contact id a staff login gets when Compass creates one (same as the 0165 backfill). */
export function internalContactIdForUser(organizationId: string, userId: string): string {
  return `internal-contact-user-${organizationId}-${userId}`
}

export function sageEmployeeLinkGapLabel(gap: SageEmployeeLinkGap): string {
  switch (gap) {
    case "no_email": return "No email in Compass"
    case "no_sage_match": return "No Sage employee has this email"
    case "sage_not_current": return "The Sage employee with this email is not current"
    case "several_sage_employees": return "Several current Sage employees have this email"
    case "several_staff": return "Several staff in Compass have this email"
    case "sage_already_linked": return "The Sage employee with this email is linked to another contact"
  }
}
