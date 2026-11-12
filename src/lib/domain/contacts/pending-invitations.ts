/**
 * "Invited" for contact editing (owner decision 2026-11-03): staff may edit
 * a person's contact information until that person ACCEPTS an invitation,
 * i.e. has an active Compass account tied to the record. A sent but
 * unaccepted invitation does not lock anything.
 *
 * When staff change the email of someone with a pending invitation, that
 * invitation still points at the old address. Directory edits do not revoke
 * or resend it and send no email; they return a warning so staff can revoke
 * and re-send it from the project's contacts. (Editing the email on the
 * project contact itself already revokes the pending invitation and warns.)
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import { invitationsView, peopleView } from "@/lib/domain/identity/views"
import type { Db } from "@/lib/server/action-context"

import { normalizeEmailKey } from "./rules"

const accessInvitations = invitationsView()
const people = peopleView()

export type PendingInvitationPerson =
  | { readonly kind: "vendor_contact"; readonly id: string }
  | { readonly kind: "customer_contact"; readonly id: string }
  | { readonly kind: "internal_contact"; readonly id: string }
  | { readonly kind: "project_contacts"; readonly ids: readonly string[] }

function personMatch(person: PendingInvitationPerson): SQL | undefined {
  switch (person.kind) {
    case "vendor_contact":
      return or(
        eq(projectContacts.vendorContactId, person.id),
        and(eq(projectContacts.sourceEntityType, "vendor_contact"), eq(projectContacts.sourceEntityId, person.id))
      )
    case "customer_contact":
      return eq(projectContacts.customerContactId, person.id)
    case "internal_contact":
      return eq(projectContacts.internalContactId, person.id)
    case "project_contacts":
      return person.ids.length > 0 ? inArray(projectContacts.id, [...person.ids]) : sql`0`
  }
}

/** Unexpired, unaccepted project invitations for this person sent to an address other than `nextEmail`. */
export async function stalePendingInvitationCount(
  db: Db,
  input: { readonly organizationId: string; readonly person: PendingInvitationPerson; readonly nextEmail: string | null; readonly now: string }
): Promise<number> {
  const rows = await db
    .select({ email: accessInvitations.email })
    .from(accessInvitations)
    .innerJoin(projectContacts, eq(projectContacts.id, accessInvitations.projectContactId))
    .where(
      and(
        eq(accessInvitations.organizationId, input.organizationId),
        eq(accessInvitations.status, "sent"),
        or(isNull(accessInvitations.workosExpiresAt), sql`${accessInvitations.workosExpiresAt} > ${input.now}`),
        personMatch(input.person)
      )
    )
    .limit(50)
  const next = normalizeEmailKey(input.nextEmail)
  return rows.filter((row) => normalizeEmailKey(row.email) !== next).length
}

export function stalePendingInvitationWarning(count: number): string | null {
  if (count === 0) return null
  return count === 1
    ? "This person has a pending Compass invitation sent to their old email. It was not resent. Revoke it and send a new invitation from the project's contacts."
    : `This person has ${count} pending Compass invitations sent to their old email. They were not resent. Revoke them and send new invitations from the project's contacts.`
}

/**
 * A linked Compass user row for an internal directory person: "account" when
 * they accepted (active, or a registered sign-in that was later deactivated),
 * "pending" for an invited user who has not accepted yet.
 */
export function internalPersonAccountState(user: { readonly id: string; readonly isActive: boolean } | null): "none" | "pending" | "account" {
  if (!user) return "none"
  if (user.isActive || user.id.startsWith("user_")) return "account"
  return "pending"
}

/** The Compass user an internal directory person is linked to, if any. */
export async function loadLinkedUser(
  db: Db,
  userId: string | null
): Promise<{ readonly id: string; readonly isActive: boolean; readonly email: string } | null> {
  if (!userId) return null
  const row = await db.select({ id: people.id, isActive: people.isActive, email: people.email }).from(people).where(eq(people.id, userId)).get()
  return row ?? null
}
