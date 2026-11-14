import { and, asc, eq, sql } from "drizzle-orm"

import { organizationMembers, userAlternateEmails, users } from "@/db/schema"
import type { ActionResult } from "@/lib/action-result"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { deleteUserAlternateEmail, insertUserAlternateEmail } from "./store"

/*
 * Other email addresses for a staff member (owner decision 2026-11-08): an
 * old company domain or a mailbox they write from. They are never used to
 * sign in. Compass uses them to recognize the person on imported messages
 * (Contacts → Needs review) and offers them as extra send-to addresses next
 * to the person's sign-in email, which stays the default.
 */

export type AlternateEmail = {
  readonly id: string
  readonly email: string
  readonly createdAt: string
}

const MAX_ALTERNATE_EMAILS = 20

const fail = (error: string): { readonly success: false; readonly error: string } => ({ success: false, error })

/** The person's other addresses in this company, oldest first. */
export async function listAlternateEmails(db: Db, organizationId: string, userId: string): Promise<readonly AlternateEmail[]> {
  return db
    .select({ id: userAlternateEmails.id, email: userAlternateEmails.email, createdAt: userAlternateEmails.createdAt })
    .from(userAlternateEmails)
    .where(and(eq(userAlternateEmails.organizationId, organizationId), eq(userAlternateEmails.userId, userId)))
    .orderBy(asc(userAlternateEmails.createdAt), asc(userAlternateEmails.email))
    .limit(MAX_ALTERNATE_EMAILS)
}

/** Is this person staff in this company? Only staff have other addresses. */
async function isStaffMember(db: Db, organizationId: string, userId: string): Promise<boolean> {
  const row = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .get()
  return row !== undefined && isInternalStaffRole(row.role)
}

/** Checks an address before it is saved; returns the normalized address or a plain-words reason. */
function checkAlternateEmail(value: string): { readonly ok: true; readonly email: string } | { readonly ok: false; readonly error: string } {
  const email = normalizeRecipientEmail(value)
  if (!email) return { ok: false, error: "Enter an email address." }
  if (!isValidRecipientEmail(email)) return { ok: false, error: "Enter a valid email address." }
  return { ok: true, email }
}

export async function addAlternateEmail(
  db: Db,
  input: { readonly organizationId: string; readonly userId: string; readonly email: string; readonly actorUserId: string | null; readonly now: string },
): Promise<ActionResult<AlternateEmail>> {
  const checked = checkAlternateEmail(input.email)
  if (!checked.ok) return fail(checked.error)
  const email = checked.email
  if (!(await isStaffMember(db, input.organizationId, input.userId))) return fail("Other email addresses can only be added for staff.")

  const [signIn, taken, existing] = await Promise.all([
    // Any account's sign-in address is that account's own; it can never be someone's other address.
    db.select({ id: users.id }).from(users).where(sql`lower(trim(${users.email})) = ${email}`).limit(1).get(),
    db
      .select({ userId: userAlternateEmails.userId })
      .from(userAlternateEmails)
      .where(and(eq(userAlternateEmails.organizationId, input.organizationId), eq(userAlternateEmails.email, email)))
      .get(),
    listAlternateEmails(db, input.organizationId, input.userId),
  ])
  if (signIn) {
    return fail(signIn.id === input.userId ? "That is already this person's sign-in email." : "That address is another person's sign-in email.")
  }
  if (taken) {
    return fail(taken.userId === input.userId ? "This address is already listed." : "Another staff member already has this address.")
  }
  if (existing.length >= MAX_ALTERNATE_EMAILS) return fail(`A person can have at most ${MAX_ALTERNATE_EMAILS} other addresses.`)

  const row = { id: crypto.randomUUID(), organizationId: input.organizationId, userId: input.userId, email, createdByUserId: input.actorUserId, createdAt: input.now }
  await insertUserAlternateEmail(db, row)
  return { success: true, data: { id: row.id, email, createdAt: row.createdAt } }
}

export async function removeAlternateEmail(
  db: Db,
  input: { readonly organizationId: string; readonly userId: string; readonly id: string },
): Promise<ActionResult<{ readonly email: string }>> {
  const row = await db
    .select({ email: userAlternateEmails.email })
    .from(userAlternateEmails)
    .where(and(
      eq(userAlternateEmails.id, input.id),
      eq(userAlternateEmails.organizationId, input.organizationId),
      eq(userAlternateEmails.userId, input.userId),
    ))
    .get()
  if (!row) return fail("That address was not found.")
  const removed = await deleteUserAlternateEmail(db, input)
  return removed ? { success: true, data: { email: row.email } } : fail("That address was not found.")
}

/**
 * Is this address another email of an active staff member here? Inbound job
 * email treats such a sender like the person's sign-in address (RFI and to-do
 * tags, @names).
 */
export async function isActiveStaffAlternateEmail(db: Db, organizationId: string, email: string): Promise<boolean> {
  const address = normalizeRecipientEmail(email)
  if (!address) return false
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(userAlternateEmails)
    .innerJoin(users, eq(users.id, userAlternateEmails.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, userAlternateEmails.userId), eq(organizationMembers.organizationId, userAlternateEmails.organizationId)))
    .where(and(eq(userAlternateEmails.organizationId, organizationId), eq(userAlternateEmails.email, address), eq(users.isActive, true)))
  return rows.some((row) => isInternalStaffRole(row.role))
}
