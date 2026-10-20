import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, projectMembers, users } from "@/db/schema"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"

export type OwnerPortalUser = {
  readonly userId: string
  readonly name: string
  readonly email: string
}

/** Active users with owner or client access to this project. */
export async function projectOwnerPortalUsers(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectId: string
): Promise<readonly OwnerPortalUser[]> {
  const rows = await db
    .select({ userId: users.id, name: users.displayName, email: users.email })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)))
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.role, ["owner", "client"]), eq(users.isActive, true)))
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const email = normalizeRecipientEmail(row.email)
    if (seen.has(row.userId) || !isValidRecipientEmail(email)) return []
    seen.add(row.userId)
    return [{ userId: row.userId, name: row.name ?? email, email }]
  })
}
