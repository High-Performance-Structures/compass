import "server-only"

import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { companiesView, membershipsView, peopleView } from "@/lib/domain/identity/views"
import type { AuthUser } from "@/lib/auth"

const memberships = membershipsView()
const companies = companiesView()
const accounts = peopleView()

/**
 * Resolve the live Compass user behind a verified agent token.
 *
 * Agent API routes are called by the in-app agent with only a bearer token,
 * never the browser session cookie, so cookie-based `getCurrentUser()` cannot
 * be used. The token is signed, but it can outlive a deactivation or role
 * change, so the user, organization and membership role are re-checked here.
 */
export async function resolveAgentUser(
  db: ReturnType<typeof getDb>,
  auth: {
    readonly userId: string
    readonly orgId: string
    readonly role: string
  },
): Promise<AuthUser | null> {
  const row = await db
    .select({
      user: accounts,
      membershipRole: memberships.role,
      organization: companies,
    })
    .from(accounts)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, accounts.id),
        eq(memberships.organizationId, auth.orgId),
      ),
    )
    .innerJoin(
      companies,
      eq(companies.id, memberships.organizationId),
    )
    .where(eq(accounts.id, auth.userId))
    .get()
  if (
    !row ||
    !row.user.isActive ||
    !row.organization.isActive ||
    row.membershipRole !== auth.role
  ) {
    return null
  }
  return {
    ...row.user,
    role: row.membershipRole,
    organizationId: row.organization.id,
    organizationName: row.organization.name,
    organizationType: row.organization.type,
  }
}
