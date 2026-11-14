/**
 * Development accounts (migration 0325): company members who build Compass
 * itself (an automation's service account, an outside developer) rather than
 * work for the company. The tag is per company membership and set by an
 * admin in Settings → Team. It never changes a role or what the person can
 * open; it only keeps them out of the company's staff lists:
 *
 * - staff people pickers (assignees, recipients, "Priced by", crews, …),
 * - staff counts (the Internal contacts tab and its count),
 * - Sage employee linking ("Staff to link to Sage" and automatic linking).
 *
 * This is not the `developer` role (`isDeveloperRole`), which is narrow
 * assigned-project testing access.
 */
import { and, eq, sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm"

import { organizationMembers, users } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { setOrganizationMemberDevelopmentAccount } from "./store"

/**
 * WHERE condition for a query that joins a membership (`membershipsView()`,
 * or an alias of it): keeps everyone except development accounts. Add it to
 * every query that offers the company's staff for picking or counts them.
 */
export function notDevelopmentAccount(membership: { readonly isDevelopmentAccount: AnyColumn }): SQL {
  return eq(membership.isDevelopmentAccount, false)
}

/**
 * WHERE condition for rows that point at a user (such as an internal
 * contact's `user_id`): keeps rows whose user is not a development account
 * of that company. Rows with no user are kept.
 */
export function userIsNotDevelopmentAccount(userId: AnyColumn | SQLWrapper, organizationId: AnyColumn | SQLWrapper | string): SQL {
  return sql`not exists (
    select 1 from ${organizationMembers} dev_member
    where dev_member.user_id = ${userId}
      and dev_member.organization_id = ${organizationId}
      and dev_member.is_development_account = 1
  )`
}

/** User ids tagged as development accounts in the company. */
export async function developmentAccountUserIds(db: Db, organizationId: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.isDevelopmentAccount, true)))
  return new Set(rows.map((row) => row.userId))
}

export type SetDevelopmentAccountResult =
  | { readonly success: true; readonly name: string; readonly changed: boolean }
  | { readonly success: false; readonly error: string }

/**
 * Tags or untags one company member as a development account. Only the tag
 * changes: never the role, the account or project access. Callers check
 * that the person asking may manage user access, and log the change.
 */
export async function setDevelopmentAccount(
  db: Db,
  input: { readonly organizationId: string; readonly userId: string; readonly developmentAccount: boolean },
): Promise<SetDevelopmentAccountResult> {
  const membership = await db
    .select({
      id: organizationMembers.id,
      current: organizationMembers.isDevelopmentAccount,
      displayName: users.displayName,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, input.userId)))
    .get()
  if (!membership) return { success: false, error: "User not found in this organization" }
  const name = membership.displayName?.trim() || membership.email
  if (membership.current === input.developmentAccount) return { success: true, name, changed: false }
  await setOrganizationMemberDevelopmentAccount(db, membership.id, input.developmentAccount)
  return { success: true, name, changed: true }
}
