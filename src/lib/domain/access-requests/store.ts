/**
 * The only code that writes organization_access_requests (architecture
 * standard, section 1). Callers resolve access first; nothing here checks
 * who is asking. Status changes are compare-and-set on "pending", so two
 * admins deciding the same request at once cannot both win.
 */
import { and, eq } from "drizzle-orm"

import { organizationAccessRequests, type NewOrganizationAccessRequest } from "@/db/schema-access-requests"
import { USER_ROLES, type UserRole } from "@/lib/domain/identity/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import { ACCESS_REQUEST_KINDS, ACCESS_REQUEST_STATUSES, type AccessRequestStatus } from "./statuses"

const LISTS = { kind: ACCESS_REQUEST_KINDS, status: ACCESS_REQUEST_STATUSES, grantedRole: USER_ROLES }

/** Inserts a pending request; returns false when one is already pending for this person and company. */
export async function insertAccessRequest(db: Db, row: NewOrganizationAccessRequest): Promise<boolean> {
  assertListFields("organization_access_requests", row, LISTS)
  const inserted = await db
    .insert(organizationAccessRequests)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: organizationAccessRequests.id })
  return inserted.length > 0
}

type Decision = {
  readonly status: Exclude<AccessRequestStatus, "pending">
  readonly decidedBy: string | null
  readonly now: string
  readonly customerContactId?: string | null
  readonly vendorContactId?: string | null
  readonly grantedRole?: UserRole | null
}

/** Moves a pending request to its decision; returns false when it was no longer pending. */
export async function decideAccessRequest(db: Db, requestId: string, decision: Decision): Promise<boolean> {
  const values = {
    status: decision.status,
    decidedBy: decision.decidedBy,
    decidedAt: decision.now,
    updatedAt: decision.now,
    customerContactId: decision.customerContactId ?? null,
    vendorContactId: decision.vendorContactId ?? null,
    grantedRole: decision.grantedRole ?? null,
  }
  assertListFields("organization_access_requests", values, LISTS)
  const updated = await db
    .update(organizationAccessRequests)
    .set(values)
    .where(and(eq(organizationAccessRequests.id, requestId), eq(organizationAccessRequests.status, "pending")))
    .returning({ id: organizationAccessRequests.id })
  return updated.length > 0
}

/** Puts a claimed approval back to pending when granting access failed part way. */
export async function reopenAccessRequest(db: Db, requestId: string, now: string): Promise<void> {
  await db
    .update(organizationAccessRequests)
    .set({
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      customerContactId: null,
      vendorContactId: null,
      grantedRole: null,
      updatedAt: now,
    })
    .where(and(eq(organizationAccessRequests.id, requestId), eq(organizationAccessRequests.status, "approved")))
    .run()
}

/** Records how many jobs an approval opened. */
export async function setAccessRequestProjectCount(db: Db, requestId: string, count: number, now: string): Promise<void> {
  await db
    .update(organizationAccessRequests)
    .set({ grantedProjectCount: count, updatedAt: now })
    .where(eq(organizationAccessRequests.id, requestId))
    .run()
}
