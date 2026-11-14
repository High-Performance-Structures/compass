/**
 * Identity reads for developer View as (src/lib/view-as/). Who an admin may
 * view (people of their own company: its staff, and the owners and vendors
 * on its jobs), the person search in the developer menu, and the viewed
 * person's sign-in identity, built exactly as sign-in builds it but without
 * any of sign-in's writes (no last-login stamp, no invitation claims).
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm"

import { organizationMembers, projects, users } from "@/db/schema"
import type { User } from "@/db/schema"
import { projectRolesForUserQuery } from "@/lib/domain/project/member-role"
import { projectMembersView } from "@/lib/domain/project/views"
import type { Db } from "@/lib/server/action-context"

import { accountById } from "./accounts"
import { organizationMembershipsQuery } from "./reads"
import { resolveSessionRole, type SessionRole } from "./session-role"

/** Is this person part of the company: a member of it, or on one of its jobs? */
export async function isPersonOfCompany(db: Db, userId: string, organizationId: string): Promise<boolean> {
  const member = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1)
    .get()
  if (member) return true
  const members = projectMembersView()
  const onJob = await db
    .select({ projectId: members.projectId })
    .from(members)
    .innerJoin(projects, eq(projects.id, members.projectId))
    .where(and(eq(members.userId, userId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .get()
  return onJob !== undefined
}

export type ViewAsPersonOption = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: string
}

function likePattern(query: string): string {
  return `%${query.trim().toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * Active accounts of the company matching a name or email, for the
 * developer menu's View as search. Company members first, then people on
 * its jobs; at most `limit` of each.
 */
export async function searchViewAsPeople(
  db: Db,
  input: { readonly organizationId: string; readonly query: string; readonly excludeUserId: string; readonly limit?: number },
): Promise<ViewAsPersonOption[]> {
  const limit = input.limit ?? 15
  const pattern = likePattern(input.query)
  const matches = or(
    sql`lower(coalesce(${users.displayName}, '')) LIKE ${pattern} ESCAPE '\\'`,
    sql`lower(${users.email}) LIKE ${pattern} ESCAPE '\\'`,
  )
  const memberRows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(users.isActive, true), matches))
    .orderBy(asc(users.displayName))
    .limit(limit)
  const members = projectMembersView()
  const jobRows = await db
    .selectDistinct({ id: users.id, displayName: users.displayName, email: users.email, role: members.role })
    .from(members)
    .innerJoin(projects, eq(projects.id, members.projectId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(projects.organizationId, input.organizationId), eq(users.isActive, true), matches))
    .orderBy(asc(users.displayName))
    .limit(limit * 3)
  const seen = new Set<string>([input.excludeUserId])
  const options: ViewAsPersonOption[] = []
  for (const row of [...memberRows, ...jobRows]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    options.push({ id: row.id, name: row.displayName || row.email, email: row.email, role: row.role })
  }
  return options.slice(0, limit * 2)
}

export type ViewAsIdentity = {
  readonly account: User
  readonly session: SessionRole
}

/**
 * The viewed person's account and the role/company Compass would give them
 * at sign-in, read only. `preferredOrgId` is the viewing admin's company, so
 * staff of several companies are seen in the admin's.
 */
export async function viewAsIdentity(
  db: Db,
  userId: string,
  preferredOrgId: string,
): Promise<ViewAsIdentity | null> {
  const account = await accountById(db, userId)
  if (!account || !account.isActive) return null
  const [orgMemberships, projectRoles] = await db.batch([
    organizationMembershipsQuery(db, userId),
    projectRolesForUserQuery(db, userId),
  ])
  const session = resolveSessionRole({
    orgMemberships,
    preferredOrgId,
    projectRoles: projectRoles.map((row) => row.role),
    accountRole: account.role,
  })
  return { account, session }
}

/** Display names for Activity entries, keyed by user id. */
export async function viewAsDisplayNames(db: Db, userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(inArray(users.id, [...userIds]))
  return new Map(rows.map((row) => [row.id, row.displayName || row.email]))
}
