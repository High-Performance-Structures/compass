import { and, eq, inArray, or } from "drizzle-orm"
import type { SQLiteInsert } from "drizzle-orm/sqlite-core"
import type { getDb } from "@/db"
import { projectContacts, projectRfis } from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { canViewRfi, PARTICIPANT_CAPABILITIES } from "@/lib/participant-access"

type Db = ReturnType<typeof getDb>

/** The participant role that makes an RFI visible to the assigned vendor company. */
export const RFI_VENDOR_ASSIGNEE_ROLE = "assignee"
/** The participant role recorded for the vendor who submitted an RFI. */
export const RFI_REQUESTER_ROLE = "requester"
// One staff-managed company assignment per RFI; re-assigning updates this row.
export const VENDOR_ASSIGNEE_PARTICIPANT_ID = "compass-vendor-assignee"
const VENDOR_CONTACT_TYPES: readonly string[] = ["subcontractor", "supplier"]

export type RfiVendorContact = {
  readonly id: string
  readonly displayName: string
  readonly companyName: string | null
  readonly vendorId: string | null
}

export type RfiVendorAssignment = {
  readonly contactId: string
  readonly label: string
  /** False when the assigned contact was deactivated; vendors lose access. */
  readonly contactActive: boolean
}

export type RfiVendorOption = {
  readonly contactId: string
  readonly label: string
}

function rfiVendorLabel(contact: { readonly displayName: string; readonly companyName: string | null }): string {
  const company = contact.companyName?.trim()
  return company && company !== contact.displayName ? `${company} · ${contact.displayName}` : contact.displayName
}

/** Only an active subcontractor/supplier contact on this project can be assigned. */
export async function resolveRfiVendorContact(db: Db, projectId: string, contactId: string): Promise<RfiVendorContact | null> {
  const [row] = await db.select({
    id: projectContacts.id,
    displayName: projectContacts.displayName,
    companyName: projectContacts.companyName,
    vendorId: projectContacts.vendorId,
  }).from(projectContacts).where(and(
    eq(projectContacts.id, contactId),
    eq(projectContacts.projectId, projectId),
    eq(projectContacts.active, true),
    inArray(projectContacts.contactType, [...VENDOR_CONTACT_TYPES]),
  )).limit(1)
  return row ?? null
}

export async function listRfiVendorOptions(db: Db, projectId: string): Promise<readonly RfiVendorOption[]> {
  const rows = await db.select({
    id: projectContacts.id,
    displayName: projectContacts.displayName,
    companyName: projectContacts.companyName,
  }).from(projectContacts).where(and(
    eq(projectContacts.projectId, projectId),
    eq(projectContacts.active, true),
    inArray(projectContacts.contactType, [...VENDOR_CONTACT_TYPES]),
  ))
  return rows
    .map((row) => ({ contactId: row.id, label: rfiVendorLabel(row) }))
    .sort((first, second) => first.label.localeCompare(second.label))
}

/**
 * Builds the statement that sets (or clears, with `contact: null`) an RFI's
 * vendor company. Clearing deactivates the row rather than deleting it so the
 * previous assignment stays inspectable.
 */
export function rfiVendorAssignmentStatement(db: Db, input: {
  readonly organizationId: string
  readonly projectId: string
  readonly rfiId: string
  readonly contact: RfiVendorContact | null
  readonly now: string
}): SQLiteInsert<typeof projectSourceRecordParticipants, "async", D1Result, undefined> {
  const key = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceRecordType: "rfi",
    sourceRecordId: input.rfiId,
    sourceParticipantId: VENDOR_ASSIGNEE_PARTICIPANT_ID,
  } as const
  if (input.contact === null) {
    // A new tombstone also suppresses historical assignees when staff clear
    // an imported assignment before any managed assignment has been created.
    return db.insert(projectSourceRecordParticipants)
      .values({ id: crypto.randomUUID(), ...key, participantRole: RFI_VENDOR_ASSIGNEE_ROLE, active: false, createdAt: input.now, updatedAt: input.now })
      .onConflictDoUpdate({
        target: [projectSourceRecordParticipants.organizationId, projectSourceRecordParticipants.projectId, projectSourceRecordParticipants.sourceRecordType, projectSourceRecordParticipants.sourceRecordId, projectSourceRecordParticipants.sourceParticipantId],
        set: { active: false, updatedAt: input.now },
      }).$dynamic()
  }
  const assignment = {
    sourceContactId: input.contact.id,
    sourceContactName: input.contact.displayName,
    sourceCompany: input.contact.companyName,
    participantRole: RFI_VENDOR_ASSIGNEE_ROLE,
    capabilitiesJson: JSON.stringify([PARTICIPANT_CAPABILITIES.rfiView]),
    projectContactId: input.contact.id,
    identityStatus: "matched",
    membershipStatus: "active",
    reviewStatus: "reviewed",
    active: true,
    updatedAt: input.now,
  }
  return db.insert(projectSourceRecordParticipants)
    .values({ id: crypto.randomUUID(), ...key, ...assignment, createdAt: input.now })
    .onConflictDoUpdate({
      target: [
        projectSourceRecordParticipants.organizationId,
        projectSourceRecordParticipants.projectId,
        projectSourceRecordParticipants.sourceRecordType,
        projectSourceRecordParticipants.sourceRecordId,
        projectSourceRecordParticipants.sourceParticipantId,
      ],
      set: assignment,
    }).$dynamic()
}

/** Current vendor company per RFI id, for the staff RFI queue. */
export async function loadRfiVendorAssignments(db: Db, input: {
  readonly organizationId: string
  readonly projectId: string
}): Promise<ReadonlyMap<string, RfiVendorAssignment>> {
  const rows = await db.select({
    rfiId: projectRfis.id,
    sourceRecordId: projectSourceRecordParticipants.sourceRecordId,
    sourceParticipantId: projectSourceRecordParticipants.sourceParticipantId,
    active: projectSourceRecordParticipants.active,
    reviewStatus: projectSourceRecordParticipants.reviewStatus,
    identityStatus: projectSourceRecordParticipants.identityStatus,
    membershipStatus: projectSourceRecordParticipants.membershipStatus,
    capabilitiesJson: projectSourceRecordParticipants.capabilitiesJson,
    contactId: projectContacts.id,
    displayName: projectContacts.displayName,
    companyName: projectContacts.companyName,
    contactActive: projectContacts.active,
  }).from(projectSourceRecordParticipants)
    .leftJoin(projectContacts, eq(projectContacts.id, projectSourceRecordParticipants.projectContactId))
    .leftJoin(projectRfis, and(eq(projectRfis.projectId, input.projectId), or(eq(projectRfis.id, projectSourceRecordParticipants.sourceRecordId), eq(projectRfis.sourceRecordId, projectSourceRecordParticipants.sourceRecordId))))
    .where(and(
      eq(projectSourceRecordParticipants.organizationId, input.organizationId),
      eq(projectSourceRecordParticipants.projectId, input.projectId),
      eq(projectSourceRecordParticipants.sourceRecordType, "rfi"),
      eq(projectSourceRecordParticipants.participantRole, RFI_VENDOR_ASSIGNEE_ROLE),
    ))
  const managed = new Set(rows.filter((row) => row.sourceParticipantId === VENDOR_ASSIGNEE_PARTICIPANT_ID).map((row) => row.rfiId ?? row.sourceRecordId))
  const assignments = new Map<string, RfiVendorAssignment>()
  for (const row of rows) {
    const id = row.rfiId ?? row.sourceRecordId
    if (!canViewRfi(row) || row.contactId === null || row.displayName === null) continue
    if (managed.has(id) && row.sourceParticipantId !== VENDOR_ASSIGNEE_PARTICIPANT_ID) continue
    assignments.set(id, { contactId: row.contactId, label: rfiVendorLabel({ displayName: row.displayName, companyName: row.companyName }), contactActive: row.contactActive ?? false })
  }
  return assignments
}
