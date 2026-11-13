/**
 * Contacts domain: removing a person from Contacts removes them from every
 * job. One cascade for every path that archives a directory person: the
 * internal directory's Archive, a client person's Remove, people removed in
 * the vendor editor, and (for staff) the Sage employee status sync.
 *
 * - Their project-contact rows become inactive and read as history. Rows are
 *   never deleted, and notes and links are kept.
 * - Their linked Compass account loses its project memberships on the
 *   company's jobs, unless the account is still active internal staff (staff
 *   reach every job through organization scope anyway).
 * - Restoring a person does not put them back on jobs.
 */
import { removeLostJobConversationAccess } from "@/lib/conversations/shared-client-conversations"
import { and, countDistinct, eq, inArray, sql } from "drizzle-orm"

import { customerContacts, internalContacts, projectContacts, projects, vendorContacts } from "@/db/schema"
import { companiesView, membershipsView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import { chunkD1Values } from "@/lib/d1-query"
import { deleteProjectMembers } from "@/lib/domain/project/store"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole, isStaffOrganizationType } from "@/lib/user-roles"

import { directoryPersonProjectContactsWhere, type DirectoryPersonKind } from "./person-status"
import { archivedPersonProjectContactsStatements } from "./store"

const companyMemberships = membershipsView()
const companies = companiesView()
const projectMemberships = projectMembersView()
const peopleRows = peopleView()

export type { DirectoryPersonKind }

/** How many of the company's jobs list this person as a current contact (for the confirm dialog). */
export async function directoryPersonJobCount(
  db: Db,
  input: { readonly organizationId: string; readonly kind: DirectoryPersonKind; readonly personId: string }
): Promise<number> {
  const row = await db
    .select({ count: countDistinct(projectContacts.projectId) })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        eq(projectContacts.active, true),
        directoryPersonProjectContactsWhere(input.kind, [input.personId])
      )
    )
    .get()
  return row?.count ?? 0
}

async function linkedUserIds(db: Db, kind: DirectoryPersonKind, personIds: readonly string[]): Promise<readonly string[]> {
  const rows = await Promise.all(
    chunkD1Values(personIds).map((ids) => {
      switch (kind) {
        case "internal_contact":
          return db.select({ userId: internalContacts.userId }).from(internalContacts).where(inArray(internalContacts.id, ids))
        case "customer_contact":
          return db.select({ userId: customerContacts.userId }).from(customerContacts).where(inArray(customerContacts.id, ids))
        case "vendor_contact":
          return db.select({ userId: vendorContacts.userId }).from(vendorContacts).where(inArray(vendorContacts.id, ids))
      }
    })
  )
  return [...new Set(rows.flat().flatMap((row) => (row.userId ? [row.userId] : [])))]
}

/** Accounts that are still active internal staff of the company keep their memberships. */
async function activeStaffUserIds(db: Db, organizationId: string, userIds: readonly string[]): Promise<ReadonlySet<string>> {
  const rows = await Promise.all(
    chunkD1Values(userIds).map((ids) =>
      db
        .select({ userId: peopleRows.id, role: companyMemberships.role, organizationType: companies.type })
        .from(peopleRows)
        .innerJoin(companyMemberships, eq(companyMemberships.userId, peopleRows.id))
        .innerJoin(companies, eq(companies.id, companyMemberships.organizationId))
        .where(and(inArray(peopleRows.id, ids), eq(peopleRows.isActive, true), eq(companyMemberships.organizationId, organizationId)))
    )
  )
  return new Set(
    rows
      .flat()
      .filter((row) => isStaffOrganizationType(row.organizationType) && isInternalStaffRole(row.role))
      .map((row) => row.userId)
  )
}

/**
 * Take archived directory people off every job of the company. Call it after
 * the person itself is archived (or marked inactive by the Sage sync).
 * Returns how many jobs listed them.
 */
export async function removeArchivedPeopleFromJobs(
  db: Db,
  input: {
    readonly organizationId: string
    readonly kind: DirectoryPersonKind
    readonly personIds: readonly string[]
    readonly now: string
  }
): Promise<{ readonly jobCount: number }> {
  if (input.personIds.length === 0) return { jobCount: 0 }
  const counts = await Promise.all(
    input.personIds.map((personId) =>
      directoryPersonJobCount(db, { organizationId: input.organizationId, kind: input.kind, personId })
    )
  )
  const [first, ...rest] = archivedPersonProjectContactsStatements(db, input)
  if (first) await db.batch([first, ...rest])

  const userIds = await linkedUserIds(db, input.kind, input.personIds)
  const staff = await activeStaffUserIds(db, input.organizationId, userIds)
  const leaving = userIds.filter((userId) => !staff.has(userId))
  for (const ids of chunkD1Values(leaving)) {
    await deleteProjectMembers(
      db,
      and(
        inArray(projectMemberships.userId, ids),
        sql`${projectMemberships.projectId} in (select id from projects where organization_id = ${input.organizationId})`
      )
    )
  }
  // Off every job, so out of every job's client and vendor conversations too.
  await removeLostJobConversationAccess({ db, organizationId: input.organizationId, projectId: null, userIds: leaving })
  return { jobCount: counts.reduce((total, count) => total + count, 0) }
}
