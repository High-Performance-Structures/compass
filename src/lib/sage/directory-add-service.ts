import "server-only"

import { and, desc, eq, gte, inArray, or } from "drizzle-orm"

import { customerContacts, customers, organizationMembers, users, vendorContacts, vendors } from "@/db/schema"
import { sageDirectoryAddRequests } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { insertSageContactCreateEvent, insertSageContactCreateProposal } from "@/lib/domain/sage-bridge/contact-store"
import { updateSageDirectoryAddRequest } from "@/lib/domain/sage-bridge/directory-add-store"
import type { SageDirectoryAddKind } from "@/lib/domain/sage-bridge/statuses"
import { insertSageClientProjectWriteOperation } from "@/lib/domain/sage-bridge/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isSageAddApprover } from "@/lib/feature-settings/sage-add-request-settings"
import { createSystemNotificationEvent, type NotificationRecipientInput } from "@/lib/notifications/create-event"
import { parseSageClientStatusId, sageClientStatusName } from "@/lib/sage/client-project-write"
import { sageContactCreateDedupeKey } from "@/lib/sage/contact-change-proposal"
import type { DuplicateMatch } from "@/lib/sage/directory-add-duplicates"
import {
  SAGE_ADD_KIND_LABELS,
  sageClientAddPayload,
  sageCompanyAddFieldsSchema,
  sagePersonAddFieldsSchema,
  sageVendorAddPayload,
} from "@/lib/sage/directory-add-request"
import type { Db } from "@/lib/server/action-context"
import { canManageUserAccessRole } from "@/lib/user-roles"

/*
 * The "Request add to Sage" workflow after the request is made: who decides,
 * what an approval queues for the Sage writer, and what Sage's answer does.
 * Nothing reaches Sage without the approver; the writers' own switches still
 * decide when queued work actually runs.
 */

type AddRequestRow = typeof sageDirectoryAddRequests.$inferSelect

const SAGE_WRITER_ACTOR: ActivityActor = { id: null, email: "sage", displayName: "Sage writer", firstName: null, lastName: null, role: "system" }

const ENTITY_TYPES: Readonly<Record<SageDirectoryAddKind, string>> = {
  vendor_company: "vendor",
  client_company: "customer",
  vendor_person: "vendor_contact",
  client_person: "customer_contact",
}

const SAGE_ADD_REVIEW_HREF = "/dashboard/contacts?review=sage-adds"

function sageAddEntityType(kind: SageDirectoryAddKind): string {
  return ENTITY_TYPES[kind]
}

/** The request's stored look-alikes; an unreadable value reads as none. */
export function parseStoredDuplicates(json: string): readonly DuplicateMatch[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter(isDuplicateMatch) : []
  } catch {
    return []
  }
}

function isDuplicateMatch(value: unknown): value is DuplicateMatch {
  return typeof value === "object" && value !== null && "name" in value && "reasons" in value && "source" in value
}

type Approvers = {
  /** Who is notified of new requests. */
  readonly recipients: readonly NotificationRecipientInput[]
  readonly decides: (user: { readonly id: string; readonly role: string }) => boolean
}

/** The company's approver (Settings > Workflows > Adding to Sage), or its active admins when none is chosen. */
export async function sageAddApprovers(db: Db, organizationId: string): Promise<Approvers> {
  const settings = await readFeatureSettings(db, organizationId, "sage-add-requests")
  const members = await db.select({ id: users.id, email: users.email, role: organizationMembers.role, active: users.isActive })
    .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
  const chosen = settings.approverUserId ? members.find((member) => member.id === settings.approverUserId && member.active) : undefined
  const recipients = chosen
    ? [{ userId: chosen.id, email: chosen.email }]
    : members.filter((member) => member.active && canManageUserAccessRole(member.role)).map((member) => ({ userId: member.id, email: member.email }))
  return {
    recipients,
    decides: (user) => isSageAddApprover(settings, { id: user.id, isAdmin: canManageUserAccessRole(user.role) }, chosen !== undefined),
  }
}

export async function notifySageAddApprovers(
  db: Db,
  input: { readonly organizationId: string; readonly requestId: string; readonly kind: SageDirectoryAddKind; readonly name: string; readonly requesterName: string; readonly closeMatches: number }
): Promise<void> {
  const approvers = await sageAddApprovers(db, input.organizationId)
  if (approvers.recipients.length === 0) return
  const lookAlikes = input.closeMatches > 0
    ? ` Compass found ${input.closeMatches} look-alike${input.closeMatches === 1 ? "" : "s"} to compare.`
    : " No look-alikes found."
  await createSystemNotificationEvent({
    organizationId: input.organizationId, projectId: null,
    eventType: "sage_add_requested", sourceType: "sage_directory_add_request", sourceId: input.requestId,
    title: `Add to Sage? ${SAGE_ADD_KIND_LABELS[input.kind]}: ${input.name}`,
    body: `${input.requesterName} asked to add ${input.name} to Sage.${lookAlikes}`,
    href: SAGE_ADD_REVIEW_HREF, priority: "normal", audience: "internal",
    recipients: approvers.recipients, delivery: { inApp: true, email: true, push: true },
  })
}

export async function notifySageAddRequester(db: Db, request: AddRequestRow, title: string, body: string): Promise<void> {
  if (!request.requestedByUserId) return
  const requester = await db.select({ id: users.id, email: users.email, active: users.isActive }).from(users)
    .where(eq(users.id, request.requestedByUserId)).get()
  if (!requester?.active) return
  await createSystemNotificationEvent({
    organizationId: request.organizationId, projectId: null,
    eventType: "sage_add_decided", sourceType: "sage_directory_add_request", sourceId: request.id,
    title, body, href: SAGE_ADD_REVIEW_HREF, priority: "normal", audience: "internal",
    recipients: [{ userId: requester.id, email: requester.email }], delivery: { inApp: true, email: false, push: true },
  })
}

export function requestName(request: AddRequestRow): string {
  try {
    const value: unknown = JSON.parse(request.fieldsJson)
    if (typeof value === "object" && value !== null && "name" in value && typeof value.name === "string") return value.name
  } catch { /* falls through */ }
  return SAGE_ADD_KIND_LABELS[request.kind]
}

/** Records one line on the record's Activity. */
export async function recordSageAddActivity(
  db: Db,
  request: AddRequestRow,
  actor: ActivityActor,
  action: string,
  summary: string,
  now: string
): Promise<void> {
  await recordActivityEvent({
    db, organizationId: request.organizationId, actor, category: "account",
    action: `sage_add.${action}`, entityType: sageAddEntityType(request.kind), entityId: request.entityId,
    summary, metadata: { requestId: request.id, kind: request.kind }, createdAt: now,
  })
}

type QueueResult = { readonly status: "sent" | "approved"; readonly error: string | null }

/**
 * Queues an approved request for the Sage writer: a company as a client/job
 * writer add, a person as a Sage contact Add under its company. A person
 * whose company isn't in Sage yet stays "approved" until it is.
 */
export async function queueApprovedSageAdd(db: Db, request: AddRequestRow, approverUserId: string, now: string): Promise<QueueResult> {
  const operationId = crypto.randomUUID()
  let raw: unknown
  try { raw = JSON.parse(request.fieldsJson) } catch { raw = null }
  if (request.kind === "vendor_company" || request.kind === "client_company") {
    const fields = sageCompanyAddFieldsSchema.safeParse(raw)
    if (!fields.success) return { status: "approved", error: "The request's details are no longer valid." }
    if (request.kind === "vendor_company") {
      const payload = sageVendorAddPayload(request.entityId, fields.data, request.vendorType ?? "", request.form1099 ?? "unknown")
      await insertSageClientProjectWriteOperation(db, {
        id: operationId, organizationId: request.organizationId, customerId: null, projectId: null, vendorId: request.entityId,
        requestedByUserId: request.requestedByUserId, operationType: "ensure_vendor", idempotencyKey: `sage-add:${request.id}`,
        payloadJson: JSON.stringify(payload), status: "queued", requestedAt: now, updatedAt: now,
      })
    } else {
      const customer = await db.select({ company: customers.company, statusId: customers.sageClientStatusId }).from(customers)
        .where(and(eq(customers.id, request.entityId), eq(customers.organizationId, request.organizationId))).get()
      const statusId = parseSageClientStatusId(customer?.statusId ?? 1) ?? 1
      const payload = sageClientAddPayload(request.entityId, fields.data, customer?.company ?? null, {
        expectedNumber: statusId, name: sageClientStatusName(statusId),
      })
      await insertSageClientProjectWriteOperation(db, {
        id: operationId, organizationId: request.organizationId, customerId: request.entityId, projectId: null,
        requestedByUserId: request.requestedByUserId, operationType: "ensure_client", idempotencyKey: `sage-add:${request.id}`,
        payloadJson: JSON.stringify(payload), status: "queued", requestedAt: now, updatedAt: now,
      })
    }
  } else {
    const fields = sagePersonAddFieldsSchema.safeParse(raw)
    if (!fields.success) return { status: "approved", error: "The request's details are no longer valid." }
    const parent = await personParent(db, request)
    if (!parent?.sageRecordId) return { status: "approved", error: null }
    const kind = request.kind
    const createFields = { ...fields.data, phoneExtension: null }
    try {
      await db.batch([
        insertSageContactCreateProposal(db, {
          id: operationId, organizationId: request.organizationId, kind,
          customerId: kind === "client_person" ? parent.id : null, vendorId: kind === "vendor_person" ? parent.id : null,
          parentSageRecordId: parent.sageRecordId, fieldsJson: JSON.stringify(createFields),
          dedupeKey: await sageContactCreateDedupeKey(kind, parent.sageRecordId, createFields),
          status: "approved", requestedByUserId: request.requestedByUserId ?? approverUserId,
          reviewedByUserId: approverUserId, reviewedAt: now, compassPersonId: request.entityId,
          requestedAt: now, updatedAt: now,
        }),
        insertSageContactCreateEvent(db, {
          id: crypto.randomUUID(), proposalId: operationId, organizationId: request.organizationId,
          actorUserId: approverUserId, eventType: "approved", detailJson: JSON.stringify({ sageAddRequestId: request.id }), createdAt: now,
        }),
      ])
    } catch {
      return { status: "approved", error: "Sage already has an Add for this person waiting. Check Sage review." }
    }
  }
  await updateSageDirectoryAddRequest(db, {
    id: request.id, organizationId: request.organizationId, fromStatuses: ["approved", "pending"],
    values: { status: "sent", writeOperationId: operationId, errorMessage: null, updatedAt: now },
  })
  return { status: "sent", error: null }
}

async function personParent(db: Db, request: AddRequestRow): Promise<{ readonly id: string; readonly sageRecordId: string | null } | null> {
  if (request.kind === "vendor_person") {
    const row = await db.select({ id: vendors.id, sageRecordId: vendors.sageVendorId }).from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendorContacts.id, request.entityId), eq(vendors.organizationId, request.organizationId))).get()
    return row ? { id: row.id, sageRecordId: row.sageRecordId?.trim() || null } : null
  }
  const row = await db.select({ id: customers.id, sageRecordId: customers.sageClientId }).from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .where(and(eq(customerContacts.id, request.entityId), eq(customers.organizationId, request.organizationId))).get()
  return row ? { id: row.id, sageRecordId: row.sageRecordId?.trim() || null } : null
}

/**
 * Sage's answer for a queued request (client/job writer result or Sage
 * contact Add result): the request is finished, the requester hears, and
 * approved people waiting on this company are queued. No-op for writes that
 * no request asked for.
 */
export async function recordSageAddOutcome(
  db: Db,
  input: {
    readonly operationId: string
    readonly organizationId: string
    readonly outcome: "succeeded" | "failed"
    readonly sageRecordId: string | null
    readonly sageRecordNumber: string | null
    readonly error: string | null
    readonly now: string
  }
): Promise<void> {
  try {
    const request = await db.select().from(sageDirectoryAddRequests).where(and(
      eq(sageDirectoryAddRequests.organizationId, input.organizationId),
      eq(sageDirectoryAddRequests.writeOperationId, input.operationId),
      eq(sageDirectoryAddRequests.status, "sent"),
    )).get()
    if (!request) return
    const changed = await updateSageDirectoryAddRequest(db, {
      id: request.id, organizationId: request.organizationId, fromStatuses: ["sent"],
      values: {
        status: input.outcome, sageRecordId: input.sageRecordId, sageRecordNumber: input.sageRecordNumber,
        errorMessage: input.error?.slice(0, 1000) ?? null, completedAt: input.now, updatedAt: input.now,
      },
    })
    if (changed === 0) return
    const name = requestName(request)
    if (input.outcome === "succeeded") {
      const number = input.sageRecordNumber ? ` as #${input.sageRecordNumber}` : ""
      await recordSageAddActivity(db, request, SAGE_WRITER_ACTOR, "succeeded", `Added ${name} to Sage${number}.`, input.now)
      await notifySageAddRequester(db, request, `${name} is in Sage`, `Sage added ${name}${number}.`)
      await queueWaitingPeople(db, request, input.now)
    } else {
      await recordSageAddActivity(db, request, SAGE_WRITER_ACTOR, "failed", `Sage didn't add ${name}: ${input.error ?? "no reason given"}`, input.now)
      await notifySageAddRequester(db, request, `Sage didn't add ${name}`, input.error ?? "The Sage writer reported a problem.")
    }
  } catch (error) {
    // Never fails the writer's result; the write itself is already recorded.
    console.error("Could not record the Sage add request outcome", error)
  }
}

/** Approved people whose company just reached Sage. */
async function queueWaitingPeople(db: Db, company: AddRequestRow, now: string): Promise<void> {
  if (company.kind !== "vendor_company" && company.kind !== "client_company") return
  const personKind = company.kind === "vendor_company" ? "vendor_person" : "client_person"
  const waiting = await db.select().from(sageDirectoryAddRequests).where(and(
    eq(sageDirectoryAddRequests.organizationId, company.organizationId),
    eq(sageDirectoryAddRequests.kind, personKind),
    eq(sageDirectoryAddRequests.status, "approved"),
  ))
  for (const person of waiting) {
    const parent = await personParent(db, person)
    const approver = person.reviewedByUserId ?? company.reviewedByUserId
    if (!approver || (parent?.id !== company.entityId && person.parentRequestId !== company.id)) continue
    await queueApprovedSageAdd(db, person, approver, now)
  }
}



/** Open requests and the last month's decisions, newest first. */
export async function listSageAddRequestRows(db: Db, organizationId: string): Promise<readonly AddRequestRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  return db.select().from(sageDirectoryAddRequests).where(and(
    eq(sageDirectoryAddRequests.organizationId, organizationId),
    or(inArray(sageDirectoryAddRequests.status, ["pending", "approved", "sent"]), gte(sageDirectoryAddRequests.updatedAt, since)),
  )).orderBy(desc(sageDirectoryAddRequests.requestedAt)).limit(100)
}
