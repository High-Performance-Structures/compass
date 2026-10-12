import "server-only"

import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationMembers, organizations, users } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"

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
      user: users,
      membershipRole: organizationMembers.role,
      organization: organizations,
    })
    .from(users)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.organizationId, auth.orgId),
      ),
    )
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .where(eq(users.id, auth.userId))
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
