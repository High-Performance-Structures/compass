import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"

const memberships = membershipsView()
const projectMemberships = projectMembersView()
const people = peopleView()

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
    .select({ userId: people.id, name: people.displayName, email: people.email })
    .from(projectMemberships)
    .innerJoin(people, eq(people.id, projectMemberships.userId))
    .innerJoin(memberships, and(eq(memberships.userId, people.id), eq(memberships.organizationId, organizationId)))
    .where(and(eq(projectMemberships.projectId, projectId), inArray(projectMemberships.role, ["owner", "client"]), eq(people.isActive, true)))
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const email = normalizeRecipientEmail(row.email)
    if (seen.has(row.userId) || !isValidRecipientEmail(email)) return []
    seen.add(row.userId)
    return [{ userId: row.userId, name: row.name ?? email, email }]
  })
}
