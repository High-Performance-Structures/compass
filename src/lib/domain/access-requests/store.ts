/**
 * The only code that writes organization_access_requests (architecture
 * standard, section 1). Callers resolve access first; nothing here checks
 * who is asking. Every status change is an event of ./machine.ts written as
 * compare-and-set on the event's source states, so two admins deciding the
 * same request at once, or an admin deciding while the person withdraws,
 * cannot both win.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"

import { organizationAccessRequests, type NewOrganizationAccessRequest } from "@/db/schema-access-requests"
import { USER_ROLES, type UserRole } from "@/lib/domain/identity/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import { accessRequestMachine, type AccessRequestEvent } from "./machine"
import { ACCESS_REQUEST_KINDS, ACCESS_REQUEST_STATUSES } from "./statuses"

const LISTS = { kind: ACCESS_REQUEST_KINDS, status: ACCESS_REQUEST_STATUSES, grantedRole: USER_ROLES }

/** The request is in a state `event` may leave from. */
function statusIn(event: AccessRequestEvent): SQL {
  return inArray(organizationAccessRequests.status, [...accessRequestMachine.transitions[event].from])
}

/** Inserts a new request (always pending); returns false when one is already pending for this person and company. */
export async function insertAccessRequest(db: Db, row: Omit<NewOrganizationAccessRequest, "status">): Promise<boolean> {
  const values = { ...row, status: accessRequestMachine.initial }
  assertListFields("organization_access_requests", values, LISTS)
  // The partial unique index organization_access_requests_one_pending turns a
  // double submit into a no-op here.
  const inserted = await db
    .insert(organizationAccessRequests)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: organizationAccessRequests.id })
  return inserted.length > 0
}

/** approve: claims a pending request for granting. False when it was no longer pending. */
export async function markAccessRequestApproved(
  db: Db,
  requestId: string,
  input: { readonly decidedBy: string; readonly grantedRole: UserRole; readonly now: string },
): Promise<boolean> {
  const values = {
    status: accessRequestMachine.transitions.approve.to,
    decidedBy: input.decidedBy,
    decidedAt: input.now,
    updatedAt: input.now,
    grantedRole: input.grantedRole,
  }
  assertListFields("organization_access_requests", values, LISTS)
  const updated = await db
    .update(organizationAccessRequests)
    .set(values)
    .where(and(eq(organizationAccessRequests.id, requestId), statusIn("approve")))
    .returning({ id: organizationAccessRequests.id })
  return updated.length > 0
}

/** decline or withdraw: ends a pending request. False when it was no longer pending. */
export async function closeAccessRequest(
  db: Db,
  requestId: string,
  event: "decline" | "withdraw",
  input: { readonly decidedBy: string; readonly now: string },
): Promise<boolean> {
  const updated = await db
    .update(organizationAccessRequests)
    .set({
      status: accessRequestMachine.transitions[event].to,
      decidedBy: input.decidedBy,
      decidedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(eq(organizationAccessRequests.id, requestId), statusIn(event)))
    .returning({ id: organizationAccessRequests.id })
  return updated.length > 0
}

/**
 * reopen: puts a claimed approval back to pending when granting failed part
 * way. Skipped when the person has since sent another pending request to the
 * same company (only one may be pending); the claimed one then stays approved.
 * Returns whether it reopened.
 */
export async function reopenAccessRequest(db: Db, requestId: string, now: string): Promise<boolean> {
  const updated = await db
    .update(organizationAccessRequests)
    .set({
      status: accessRequestMachine.transitions.reopen.to,
      decidedBy: null,
      decidedAt: null,
      // customerContactId / vendorContactId stay: a directory person the
      // failed attempt created is reused by the retry (no second client).
      grantedRole: null,
      grantedProjectCount: null,
      updatedAt: now,
    })
    .where(and(
      eq(organizationAccessRequests.id, requestId),
      statusIn("reopen"),
      sql`NOT EXISTS (SELECT 1 FROM organization_access_requests other
        WHERE other.organization_id = organization_access_requests.organization_id
          AND other.user_id = organization_access_requests.user_id
          AND other.status = ${accessRequestMachine.initial})`,
    ))
    .returning({ id: organizationAccessRequests.id })
  return updated.length > 0
}

/** Records what an approval granted: the directory person it linked and how many jobs it opened. */
/**
 * Remembers the directory person an approval just created, before granting,
 * so a retry after a failed grant reuses it instead of adding another.
 */
export async function rememberAccessRequestPerson(
  db: Db,
  requestId: string,
  input: { readonly kind: "client" | "vendor"; readonly personId: string; readonly now: string },
): Promise<void> {
  await db
    .update(organizationAccessRequests)
    .set(input.kind === "client"
      ? { customerContactId: input.personId, updatedAt: input.now }
      : { vendorContactId: input.personId, updatedAt: input.now })
    .where(eq(organizationAccessRequests.id, requestId))
    .run()
}

export async function recordAccessRequestGrant(
  db: Db,
  requestId: string,
  input: {
    readonly customerContactId: string | null
    readonly vendorContactId: string | null
    readonly projectCount: number
    readonly now: string
  },
): Promise<void> {
  await db
    .update(organizationAccessRequests)
    .set({
      customerContactId: input.customerContactId,
      vendorContactId: input.vendorContactId,
      grantedProjectCount: input.projectCount,
      updatedAt: input.now,
    })
    .where(eq(organizationAccessRequests.id, requestId))
    .run()
}
