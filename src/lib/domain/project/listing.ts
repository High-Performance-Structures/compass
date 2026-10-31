/** Read models for the project intake pickers. Scoped to one organization. */
import { and, asc, eq, isNull } from "drizzle-orm"

import { customers, organizationMembers, users } from "@/db/schema"
import { sageClientLinkReviewIds } from "@/lib/sage/client-link-review"
import type { Db } from "@/lib/server/action-context"

import type { ProjectIntakeAssignee, ProjectIntakeCustomerOption } from "./intake-types"
import { intakeAssigneeName } from "./rules"

export async function loadIntakeCustomerOptions(
  db: Db,
  organizationId: string,
): Promise<readonly ProjectIntakeCustomerOption[]> {
  const rows = await db.select({
    id: customers.id,
    name: customers.name,
    company: customers.company,
    email: customers.email,
    phone: customers.phone,
    sageClientStatusId: customers.sageClientStatusId,
    sageClientId: customers.sageClientId,
    sageClientNumber: customers.sageClientNumber,
  })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId)))
    .orderBy(asc(customers.name))
  const reviewIds = sageClientLinkReviewIds(rows)
  return rows.map((customer) => ({
    id: customer.id,
    name: customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    sageClientStatusId: customer.sageClientStatusId,
    sageLinkNeedsReview: reviewIds.has(customer.id),
  }))
}

export async function loadIntakeAssignees(
  db: Db,
  organizationId: string,
): Promise<readonly ProjectIntakeAssignee[]> {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))

  return rows.map((row) => ({
    id: row.id,
    name: intakeAssigneeName(row),
    email: row.email,
  }))
}
