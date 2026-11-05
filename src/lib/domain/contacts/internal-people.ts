/**
 * Staff edits of internal directory people (Contacts → Internal), including
 * archived ones such as the people the Buildertrend importer adds. The rules
 * (owner decision 2026-11-03):
 * - Until the person accepts a Compass invitation, staff edit their name,
 *   job title, email, phone and mobile. A pending invitation does not lock.
 * - Once they have a Compass account, staff still edit everything except
 *   the email they sign in with (owner decision 2026-11-04).
 * - A Sage-linked employee's email, phone and mobile belong to Sage and are
 *   changed through "Propose Sage edit"; name and job title are Compass-only
 *   (Sage read-back never writes them) and stay editable here.
 * Callers check permissions, log activity and revalidate.
 */
import { and, eq } from "drizzle-orm"

import { internalContacts } from "@/db/schema"
import type { ActionFailure } from "@/lib/action-result"
import { SIGN_IN_EMAIL_LOCK } from "@/lib/contact-identity-ownership"
import type { Db } from "@/lib/server/action-context"

import {
  internalPersonAccountState,
  loadLinkedUser,
  stalePendingInvitationCount,
  stalePendingInvitationWarning,
} from "./pending-invitations"
import { normalizeEmailKey } from "./rules"
import { updateInternalPerson } from "./store"

export type InternalPersonInput = {
  readonly name: string
  readonly jobTitle: string
  readonly email: string
  readonly phone: string
  readonly cellPhone: string
}

/** An accepted person's sign-in email is theirs; everything else is staff-editable. */
export const INTERNAL_ACCOUNT_LOCK = SIGN_IN_EMAIL_LOCK
export const INTERNAL_SAGE_LOCK =
  "This employee is linked to Sage. Change their email, phone or mobile with Propose Sage edit."

function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function same(left: string | null, right: string | null): boolean {
  return (left?.trim() ?? "") === (right?.trim() ?? "")
}

type Person = typeof internalContacts.$inferSelect

async function loadPerson(db: Db, organizationId: string, personId: string): Promise<Person | undefined> {
  return db
    .select()
    .from(internalContacts)
    .where(and(eq(internalContacts.id, personId), eq(internalContacts.organizationId, organizationId)))
    .get()
}

function isSageLinkedEmployee(person: { readonly sageEmployeeId: string | null; readonly sageEmployeeNumber: string | null }): boolean {
  return Boolean(person.sageEmployeeId?.trim() || person.sageEmployeeNumber?.trim())
}

/** Saves a staff edit; returns what changed and any warning to show. */
export async function saveInternalPerson(
  db: Db,
  input: { readonly organizationId: string; readonly personId: string; readonly person: InternalPersonInput; readonly now: string }
): Promise<
  | { readonly success: true; readonly name: string; readonly changed: readonly string[]; readonly warning: string | null }
  | ActionFailure
> {
  const name = input.person.name.trim()
  if (!name) return { success: false, error: "Name is required." }
  const existing = await loadPerson(db, input.organizationId, input.personId)
  if (!existing) return { success: false, error: "Internal contact was not found." }
  const linkedUser = await loadLinkedUser(db, existing.userId)

  const next = {
    name,
    jobTitle: text(input.person.jobTitle),
    email: text(input.person.email)?.toLowerCase() ?? null,
    phone: text(input.person.phone),
    cellPhone: text(input.person.cellPhone),
  }
  const emailChanged = normalizeEmailKey(existing.email) !== normalizeEmailKey(next.email)
  if (emailChanged && internalPersonAccountState(linkedUser) === "account") return { success: false, error: INTERNAL_ACCOUNT_LOCK }
  const sageFieldsChanged = emailChanged || !same(existing.phone, next.phone) || !same(existing.cellPhone, next.cellPhone)
  if (isSageLinkedEmployee(existing) && sageFieldsChanged) return { success: false, error: INTERNAL_SAGE_LOCK }

  const changed = [
    ...(existing.name !== next.name ? ["name"] : []),
    ...(!same(existing.jobTitle, next.jobTitle) ? ["jobTitle"] : []),
    ...(emailChanged ? ["email"] : []),
    ...(!same(existing.phone, next.phone) ? ["phone"] : []),
    ...(!same(existing.cellPhone, next.cellPhone) ? ["cellPhone"] : []),
  ]
  if (changed.length === 0) return { success: true, name, changed, warning: null }

  await updateInternalPerson(db, { organizationId: input.organizationId, personId: input.personId, values: next, now: input.now })

  if (!emailChanged) return { success: true, name, changed, warning: null }
  const stale = await stalePendingInvitationCount(db, {
    organizationId: input.organizationId,
    person: { kind: "internal_contact", id: input.personId },
    nextEmail: next.email,
    now: input.now,
  })
  const pendingUserStale =
    internalPersonAccountState(linkedUser) === "pending" &&
    linkedUser !== null &&
    normalizeEmailKey(linkedUser.email) !== normalizeEmailKey(next.email)
  const warning = [
    stalePendingInvitationWarning(stale),
    pendingUserStale
      ? `Their pending Compass invitation was sent to ${linkedUser.email} and was not changed or resent. Revoke and re-invite them from user management to use the new email.`
      : null,
  ].filter((value): value is string => value !== null).join(" ")
  return { success: true, name, changed, warning: warning || null }
}

/**
 * Archive hides the person from the directory and every picker; restore
 * brings them back. People linked to a Compass user (invited or accepted)
 * and Sage-linked employees are not archived here.
 */
export async function setInternalPersonArchived(
  db: Db,
  input: { readonly organizationId: string; readonly personId: string; readonly archived: boolean; readonly now: string }
): Promise<{ readonly success: true; readonly name: string } | ActionFailure> {
  const existing = await loadPerson(db, input.organizationId, input.personId)
  if (!existing) return { success: false, error: "Internal contact was not found." }
  if (input.archived) {
    if (!existing.active) return { success: true, name: existing.name }
    if (existing.userId) {
      return { success: false, error: "This person is linked to a Compass user. Manage their access in user management instead." }
    }
    if (isSageLinkedEmployee(existing)) {
      return { success: false, error: "Sage-linked employees stay in the directory. Change them in Sage." }
    }
  } else if (existing.active) {
    return { success: true, name: existing.name }
  }
  await updateInternalPerson(db, {
    organizationId: input.organizationId,
    personId: input.personId,
    values: { active: !input.archived },
    now: input.now,
  })
  return { success: true, name: existing.name }
}
