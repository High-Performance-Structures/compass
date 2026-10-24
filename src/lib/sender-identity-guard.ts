import { and, ne, or, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { users } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"

/**
 * Compass sends mail *as* a user's users.email / users.googleEmail through
 * Google domain-wide delegation, so assigning an address to someone grants
 * them send-as power over that mailbox. These helpers keep one mailbox from
 * being claimed by two identities (another person, or a department sender).
 */

type GuardDb = ReturnType<typeof getDb>

/** Trimmed, lower-cased address, or null when it isn't a plausible email. */
export function normalizeEmailAddress(raw: string): string | null {
  const address = normalizeRecipientEmail(raw)
  return isValidRecipientEmail(address) ? address : null
}
/** True when the address's domain is exactly the Workspace domain (no subdomains). */
export function isAddressInWorkspaceDomain(
  address: string,
  workspaceDomain: string
): boolean {
  const domain = workspaceDomain.trim().toLowerCase().replace(/^@/, "")
  if (!domain) return false
  const at = address.lastIndexOf("@")
  return at > 0 && address.slice(at + 1).toLowerCase() === domain
}

export type SenderAddressConflict =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "department"; readonly department: string }

/**
 * Finds another identity already using `address` (case-insensitive): any
 * other user's email or googleEmail, or one of the organization's
 * department sender mailboxes. Returns null when the address is free.
 */
export async function findSenderAddressConflict(
  db: GuardDb,
  input: {
    readonly organizationId: string
    readonly address: string
    /** The user the address is being assigned to; their own row never conflicts. */
    readonly excludeUserId: string | null
  }
): Promise<SenderAddressConflict | null> {
  const address = input.address.trim().toLowerCase()
  const matchesAddress = or(
    sql`lower(trim(${users.email})) = ${address}`,
    sql`lower(trim(${users.googleEmail})) = ${address}`
  )
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(
      input.excludeUserId
        ? and(ne(users.id, input.excludeUserId), matchesAddress)
        : matchesAddress
    )
    .limit(1)
    .get()
  if (userRow) return { kind: "user", userId: userRow.id }

  // Read settings directly (not readDepartmentProfiles, which falls back to
  // defaults on error) so a failed read blocks the change instead of passing.
  const { departments: profiles } = await readFeatureSettings(
    db,
    input.organizationId,
    "department-profiles"
  )
  for (const department of DEPARTMENT_CODES) {
    const sender = profiles[department].senderAddress.trim().toLowerCase()
    if (sender && sender === address) return { kind: "department", department }
  }
  return null
}

/** Plain-language message for a conflict, safe to show to admins. */
export function describeSenderAddressConflict(
  conflict: SenderAddressConflict
): string {
  return conflict.kind === "user"
    ? "That address already belongs to another Compass user."
    : "That address is a department's sending mailbox and can't be assigned to a person."
}
