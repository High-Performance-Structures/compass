import "server-only"

import { and, eq } from "drizzle-orm"
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs"
import type { getDb } from "@/db"
import { organizationMembers, organizations, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { isInternalStaffRole } from "@/lib/user-roles"
import { isValidRecipientEmail, normalizeRecipientEmail } from "./recipient-options"
import { replyMailboxEmail } from "./reply-tracking"
import { getCompassSystemSender } from "./compass-email"
import { findSenderAddressConflict } from "@/lib/sender-identity-guard"

export type StaffEmailSender = {
  readonly address: string
  readonly name: string | null
}

/** Resolve only persisted staff identities in the record's organization. */
export async function resolveStaffEmailSender(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly userId: string
  readonly departmentSender?: StaffEmailSender
}): Promise<
  | { readonly success: true; readonly delivery: "gmail" | "system"; readonly sender: StaffEmailSender }
  | { readonly success: false; readonly error: string }
> {
  const staff = await input.db.select({
    email: users.email,
    googleEmail: users.googleEmail,
    name: users.displayName,
    role: organizationMembers.role,
    organizationType: organizations.type,
  }).from(users)
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.userId, users.id),
      eq(organizationMembers.organizationId, input.organizationId),
    ))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(users.id, input.userId), eq(users.isActive, true))).get()
  if (!staff || staff.organizationType !== "internal" || !isInternalStaffRole(staff.role)) {
    return { success: false, error: "Only active staff in this organization can send correspondence." }
  }
  if (input.departmentSender) return { success: true, delivery: "gmail", sender: input.departmentSender }
  const name = staff.name?.replace(/[\r\n"\\<>]/g, " ").replace(/\s+/g, " ").trim() || staff.email
  const workspace = await input.db.select({ domain: googleAuth.workspaceDomain })
    .from(googleAuth).where(eq(googleAuth.organizationId, input.organizationId)).get()
  const domain = workspace?.domain.trim().toLowerCase()
  const inWorkspace = (candidate: string | null): boolean => {
    if (!candidate || !domain) return false
    const email = normalizeRecipientEmail(candidate)
    return isValidRecipientEmail(email) && email.split("@")[1] === domain
  }
  // Prefer the account's primary address. The Google override is managed by
  // user administrators and supports staff who log in with a personal email.
  const address = inWorkspace(staff.email) ? staff.email : inWorkspace(staff.googleEmail) ? staff.googleEmail : null
  if (address) {
    const normalized = normalizeRecipientEmail(address)
    if (inWorkspace(staff.email)) {
      // A profile edit updates the local row before verification completes.
      // Read WorkOS afresh so neither that row nor a stale session grants send-as.
      try {
        const session = await withAuth()
        if (!session.user) return { success: false, error: "Sign in again before sending email." }
        // Local legacy user IDs need not equal the authenticated WorkOS ID.
        const identity = await getWorkOS().userManagement.getUser(session.user.id)
        if (!identity.emailVerified || normalizeRecipientEmail(identity.email) !== normalized) {
          return { success: false, error: "Verify your account email before using it as a sending mailbox." }
        }
      } catch {
        return { success: false, error: "Your sending identity could not be verified. Try again after signing in." }
      }
    }
    const conflict = await findSenderAddressConflict(input.db, { organizationId: input.organizationId, address: normalized, excludeUserId: input.userId })
    if (conflict) return { success: false, error: "This mailbox belongs to another account or department. Ask an administrator to check your sending address." }
    return { success: true, delivery: "gmail", sender: { address: normalized, name } }
  }
  const replyMailbox = replyMailboxEmail(input.env)
  // HPS uses Jarvis for staff without mailboxes. Other Workspaces and companies
  // without Google keep their configured system sender/provider chain.
  return inWorkspace(replyMailbox)
    ? { success: true, delivery: "gmail", sender: { address: replyMailbox, name: `${name} via Compass` } }
    : { success: true, delivery: "system", sender: { ...getCompassSystemSender(input.env), name: `${name} via Compass` } }
}
