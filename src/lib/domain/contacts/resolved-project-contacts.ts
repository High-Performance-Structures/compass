/**
 * The project-contact read model: a project contact reads name, company,
 * email, phone and address from its directory record (copies are a
 * fallback), in one query. The column expressions and directory joins are in
 * resolved-columns.ts; every write goes through store.ts.
 */
import { and, asc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { resolvedContactColumns, withContactDirectory } from "./resolved-columns"

type ProjectContactRow = typeof projectContacts.$inferSelect

/**
 * SQL that holds while this project contact is still on its job (not removed
 * or archived), for a grant of access through it that must not land after
 * staff took the person off the job.
 */
export function projectContactActiveCondition(contactId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${projectContacts} WHERE ${projectContacts.id} = ${contactId} AND ${projectContacts.active} = 1)`
}

type ResolvedOrder = "summary" | "type_then_name" | "name"

function orderBy(order: ResolvedOrder): readonly SQL[] {
  const name = asc(resolvedContactColumns.displayName)
  switch (order) {
    case "summary":
      return [asc(projectContacts.sortOrder), asc(projectContacts.contactType), name]
    case "type_then_name":
      return [asc(projectContacts.contactType), name]
    case "name":
      return [name]
  }
}

/**
 * Project contacts with directory-owned fields read from the linked record,
 * in one query. `where` narrows the project's rows (visibility, type,
 * active); directory joins are scoped to the organization.
 */
export async function resolvedProjectContacts(
  db: Db,
  query: {
    readonly organizationId: string
    readonly projectId: string
    readonly where?: SQL
    readonly order: ResolvedOrder
  }
): Promise<readonly ProjectContactRow[]> {
  const select = db
    .select({ ...getTableColumns(projectContacts), ...resolvedContactColumns })
    .from(projectContacts)
    .$dynamic()
  return withContactDirectory(select, query.organizationId)
    .where(and(eq(projectContacts.projectId, query.projectId), query.where))
    .orderBy(...orderBy(query.order))
}

/**
 * Phone and address (from the directory record, else the copy) for these
 * project contacts, keyed by contact id. Sign-in uses it to fill an invited
 * person's empty profile fields from the contact they were invited as.
 */
export async function projectContactPhoneAndAddress(
  db: Db,
  contactIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly phone: string | null; readonly address: string | null }>> {
  if (contactIds.length === 0) return new Map()
  const rows = await withContactDirectory(
    db
      .select({ id: projectContacts.id, phone: resolvedContactColumns.phone, address: resolvedContactColumns.address })
      .from(projectContacts)
      .where(inArray(projectContacts.id, [...contactIds]))
      .$dynamic(),
  )
  return new Map(rows.map((row) => [row.id, { phone: row.phone, address: row.address }]))
}
