/**
 * The project-contact read model: a project contact reads name, company,
 * email, phone and address from its directory record (copies are a
 * fallback), in one query. The column expressions are in resolved-columns.ts;
 * every write goes through store.ts.
 */
import { and, asc, eq, getTableColumns, or, sql, type SQL } from "drizzle-orm"

import { customerContacts, customers, internalContacts, organizationMembers, projectContacts, users, vendorContacts, vendors } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { resolvedAddress, resolvedCompanyName, resolvedDisplayName, resolvedEmail, resolvedPhone } from "./resolved-columns"

type ProjectContactRow = typeof projectContacts.$inferSelect

type ResolvedOrder = "summary" | "type_then_name" | "name"

function orderBy(order: ResolvedOrder): readonly SQL[] {
  switch (order) {
    case "summary":
      return [asc(projectContacts.sortOrder), asc(projectContacts.contactType), asc(projectContacts.displayName)]
    case "type_then_name":
      return [asc(projectContacts.contactType), asc(projectContacts.displayName)]
    case "name":
      return [asc(projectContacts.displayName)]
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
  const { organizationId } = query
  return db
    .select({
      ...getTableColumns(projectContacts),
      displayName: sql<string>`${resolvedDisplayName}`,
      companyName: sql<string | null>`${resolvedCompanyName}`,
      email: sql<string | null>`${resolvedEmail}`,
      phone: sql<string | null>`${resolvedPhone}`,
      address: sql<string | null>`${resolvedAddress}`,
    })
    .from(projectContacts)
    .leftJoin(
      customers,
      and(
        or(
          eq(projectContacts.customerId, customers.id),
          and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, customers.id))
        ),
        eq(customers.organizationId, organizationId)
      )
    )
    .leftJoin(
      customerContacts,
      and(
        eq(projectContacts.customerContactId, customerContacts.id),
        eq(customerContacts.customerId, customers.id),
        eq(customerContacts.active, true)
      )
    )
    .leftJoin(
      vendors,
      and(
        or(
          eq(projectContacts.vendorId, vendors.id),
          and(eq(projectContacts.sourceEntityType, "vendor"), eq(projectContacts.sourceEntityId, vendors.id))
        ),
        eq(vendors.organizationId, organizationId)
      )
    )
    .leftJoin(
      vendorContacts,
      and(
        eq(projectContacts.vendorContactId, vendorContacts.id),
        eq(vendorContacts.vendorId, vendors.id),
        eq(vendorContacts.active, true)
      )
    )
    .leftJoin(
      users,
      and(
        eq(projectContacts.sourceEntityType, "user"),
        eq(projectContacts.sourceEntityId, users.id),
        sql`exists (
          select 1 from ${organizationMembers}
          where ${organizationMembers.userId} = ${users.id}
            and ${organizationMembers.organizationId} = ${organizationId}
        )`
      )
    )
    .leftJoin(
      internalContacts,
      and(
        eq(projectContacts.internalContactId, internalContacts.id),
        eq(internalContacts.organizationId, organizationId),
        eq(internalContacts.active, true)
      )
    )
    .where(and(eq(projectContacts.projectId, query.projectId), query.where))
    .orderBy(...orderBy(query.order))
}
