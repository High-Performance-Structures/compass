/**
 * The project-contact read model: a project contact reads name, company,
 * email, phone and address from its directory record (copies are a
 * fallback), in one query. The column expressions and directory joins are in
 * resolved-columns.ts; every write goes through store.ts.
 */
import { and, asc, eq, getTableColumns, type SQL } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { resolvedContactColumns, withContactDirectory } from "./resolved-columns"

type ProjectContactRow = typeof projectContacts.$inferSelect

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
