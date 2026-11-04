/**
 * Editing and archiving a person on Contacts → Unassigned: someone the
 * Buildertrend importer (or Needs review) added to projects who is not
 * connected to a vendor or client yet. One person is one identity with a
 * project-contact row on each project they appear on; an edit changes every
 * row together.
 *
 * Staff may edit until the person ACCEPTS a Compass invitation on any of
 * those rows (owner decision 2026-11-03). A pending invitation does not
 * lock; changing the email then returns a warning instead of resending.
 * Callers check permissions, log activity and revalidate.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm"

import { organizationMembers, projectAccessInvitations, projectContacts, projectMembers, users } from "@/db/schema"
import type { ActionFailure } from "@/lib/action-result"
import type { Db } from "@/lib/server/action-context"

import { stalePendingInvitationCount, stalePendingInvitationWarning } from "./pending-invitations"
import { normalizeEmailKey } from "./rules"
import { deactivateProjectContact, updateUnassignedPersonRows } from "./store"
import { unassignedPersonWhere } from "./unassigned-people"

export type UnassignedPersonInput = {
  readonly name: string
  readonly email: string
  readonly phone: string
  readonly companyName: string
}

export const UNASSIGNED_ACCOUNT_LOCK =
  "This person has accepted a Compass invitation and manages their own contact information."

type Row = {
  readonly id: string
  readonly projectId: string
  readonly displayName: string
  readonly email: string | null
  readonly phone: string | null
  readonly companyName: string | null
}

async function personRows(db: Db, organizationId: string, identity: string): Promise<readonly Row[]> {
  return db
    .select({
      id: projectContacts.id,
      projectId: projectContacts.projectId,
      displayName: projectContacts.displayName,
      email: projectContacts.email,
      phone: projectContacts.phone,
      companyName: projectContacts.companyName,
    })
    .from(projectContacts)
    .where(
      and(
        unassignedPersonWhere(organizationId),
        or(
          eq(projectContacts.sourceEntityId, identity),
          and(isNull(projectContacts.sourceEntityId), eq(projectContacts.id, identity))
        )
      )
    )
    .limit(200)
}

/**
 * True once the person holds an accepted, active Compass account on one of
 * their projects: an accepted invitation on a row, or an active org user with
 * the row's email who is a member of that project (the same tests the
 * project contact editor uses).
 */
async function unassignedPersonHasAccount(db: Db, organizationId: string, rows: readonly Row[]): Promise<boolean> {
  if (rows.length === 0) return false
  const accepted = await db
    .select({ id: projectAccessInvitations.id })
    .from(projectAccessInvitations)
    .innerJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
    .where(
      and(
        inArray(projectAccessInvitations.projectContactId, rows.map((row) => row.id)),
        eq(projectAccessInvitations.status, "accepted"),
        eq(users.isActive, true)
      )
    )
    .limit(1)
  if (accepted.length > 0) return true
  const emails = [...new Set(rows.map((row) => normalizeEmailKey(row.email)).filter(Boolean))]
  if (emails.length === 0) return false
  const members = await db
    .select({ email: users.email, projectId: projectMembers.projectId })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true),
        inArray(projectMembers.projectId, [...new Set(rows.map((row) => row.projectId))])
      )
    )
  return members.some((member) =>
    rows.some((row) => row.projectId === member.projectId && normalizeEmailKey(row.email) === normalizeEmailKey(member.email))
  )
}

function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function saveUnassignedPerson(
  db: Db,
  input: { readonly organizationId: string; readonly identity: string; readonly person: UnassignedPersonInput; readonly now: string }
): Promise<
  | { readonly success: true; readonly contactIds: readonly string[]; readonly projectIds: readonly string[]; readonly changed: readonly string[]; readonly warning: string | null }
  | ActionFailure
> {
  const name = input.person.name.trim()
  if (!name) return { success: false, error: "Name is required." }
  const rows = await personRows(db, input.organizationId, input.identity)
  const first = rows[0]
  if (!first) return { success: false, error: "This person is no longer unassigned. Refresh the list." }
  if (await unassignedPersonHasAccount(db, input.organizationId, rows)) return { success: false, error: UNASSIGNED_ACCOUNT_LOCK }

  const values = {
    displayName: name,
    email: text(input.person.email)?.toLowerCase() ?? null,
    phone: text(input.person.phone),
    companyName: text(input.person.companyName),
  }
  const changed = [
    ...(rows.some((row) => row.displayName !== values.displayName) ? ["name"] : []),
    ...(rows.some((row) => normalizeEmailKey(row.email) !== normalizeEmailKey(values.email)) ? ["email"] : []),
    ...(rows.some((row) => (row.phone?.trim() ?? "") !== (values.phone ?? "")) ? ["phone"] : []),
    ...(rows.some((row) => (row.companyName?.trim() ?? "") !== (values.companyName ?? "")) ? ["companyName"] : []),
  ]
  const contactIds = rows.map((row) => row.id)
  const projectIds = [...new Set(rows.map((row) => row.projectId))]
  if (changed.length === 0) return { success: true, contactIds, projectIds, changed, warning: null }

  await updateUnassignedPersonRows(db, { contactIds, values: { ...values, updatedAt: input.now } })
  const warning = changed.includes("email")
    ? stalePendingInvitationWarning(
        await stalePendingInvitationCount(db, {
          organizationId: input.organizationId,
          person: { kind: "project_contacts", ids: contactIds },
          nextEmail: values.email,
          now: input.now,
        })
      )
    : null
  return { success: true, contactIds, projectIds, changed, warning }
}

/**
 * Archive takes the person off every project's contact list. Rows are kept
 * (never deleted) so imported message history still names them, and their
 * source links are left in place for the same reason.
 */
export async function archiveUnassignedPerson(
  db: Db,
  input: { readonly organizationId: string; readonly identity: string; readonly now: string }
): Promise<{ readonly success: true; readonly name: string; readonly contactIds: readonly string[]; readonly projectIds: readonly string[] } | ActionFailure> {
  const rows = await personRows(db, input.organizationId, input.identity)
  const first = rows[0]
  if (!first) return { success: false, error: "This person is no longer unassigned. Refresh the list." }
  if (await unassignedPersonHasAccount(db, input.organizationId, rows)) return { success: false, error: UNASSIGNED_ACCOUNT_LOCK }
  const pending = await stalePendingInvitationCount(db, {
    organizationId: input.organizationId,
    person: { kind: "project_contacts", ids: rows.map((row) => row.id) },
    nextEmail: null,
    now: input.now,
  })
  if (pending > 0) {
    return { success: false, error: "This person has a pending Compass invitation. Remove them from that project's contacts to revoke it first." }
  }
  for (const row of rows) {
    await deactivateProjectContact(db, { projectId: row.projectId, contactId: row.id, now: input.now })
  }
  return {
    success: true,
    name: first.displayName,
    contactIds: rows.map((row) => row.id),
    projectIds: [...new Set(rows.map((row) => row.projectId))],
  }
}
