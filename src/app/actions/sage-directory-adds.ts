"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { vendorContacts } from "@/db/schema"
import { sageDirectoryAddRequests } from "@/db/schema-sage"
import { actionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import { updateCustomerById, updateCustomerPerson, updateVendor, updateVendorPersonStatement } from "@/lib/domain/contacts/store"
import { insertSageDirectoryAddRequest, updateSageDirectoryAddRequest } from "@/lib/domain/sage-bridge/directory-add-store"
import type { SageDirectoryAddKind, SageDirectoryAddStatus } from "@/lib/domain/sage-bridge/statuses"
import { loadDirectoryCandidates, loadSageAddTarget, type SageAddTarget } from "@/lib/sage/directory-add-candidates"
import { findDirectoryDuplicates, type DuplicateCheck, type DuplicateMatch } from "@/lib/sage/directory-add-duplicates"
import {
  SAGE_ADD_KIND_LABELS,
  SAGE_ADD_STATUS_LABELS,
  companyAddressLine,
  isOpenSageAddStatus,
  sageDirectoryAddInputSchema,
  sageDirectoryAddKindSchema,
} from "@/lib/sage/directory-add-request"
import {
  listSageAddRequestRows,
  notifySageAddApprovers,
  notifySageAddRequester,
  parseStoredDuplicates,
  queueApprovedSageAdd,
  recordSageAddActivity,
  requestName,
  sageAddApprovers,
} from "@/lib/sage/directory-add-service"
import { orgContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"
import { peopleView } from "@/lib/domain/identity/views"

const users = peopleView()

/*
 * Contacts → "Request add to Sage": office staff ask, Compass checks for
 * duplicates, the company's approver decides (Settings > Workflows > Adding
 * to Sage). Approved requests go to the Sage writer; see
 * src/lib/sage/directory-add-service.ts.
 */

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function directoryFeature(kind: SageDirectoryAddKind): "vendors" | "customers" {
  return kind === "vendor_company" || kind === "vendor_person" ? "vendors" : "customers"
}

function isOfficeStaff(user: AuthUser): boolean {
  return user.organizationType === "internal" && isInternalStaffRole(user.role)
}

function displayName(user: { readonly displayName: string | null; readonly firstName: string | null; readonly email: string }): string {
  return user.displayName?.trim() || user.firstName?.trim() || user.email
}

export type SageAddRequestForm = {
  readonly target: SageAddTarget
  /** Look-alikes for the record as Compass has it now. */
  readonly duplicates: DuplicateCheck
}

async function duplicatesFor(db: Db, organizationId: string, target: SageAddTarget, fields: { readonly name: string; readonly email: string | null; readonly phone: string | null }): Promise<DuplicateCheck> {
  const candidates = await loadDirectoryCandidates(db, organizationId, target.kind)
  return findDirectoryDuplicates({
    kind: target.kind, id: target.entityId, name: fields.name, email: fields.email, phone: fields.phone,
    parentId: "parent" in target ? target.parent.id : null,
  }, candidates)
}

/** What the request dialog shows: the record's details and its look-alikes. */
export async function getSageAddRequestForm(kindInput: string, entityId: string): Promise<Result<SageAddRequestForm>> {
  try {
    const kind = sageDirectoryAddKindSchema.safeParse(kindInput)
    if (!kind.success) return { success: false, error: "Choose a vendor, client, or contact." }
    const context = await orgContext({ feature: directoryFeature(kind.data), action: "read" })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isOfficeStaff(user)) return { success: false, error: "Only office staff can ask to add records to Sage." }
    const target = await loadSageAddTarget(db, organizationId, kind.data, entityId)
    if (!target) return { success: false, error: "That record was not found." }
    return { success: true, data: { target, duplicates: await duplicatesFor(db, organizationId, target, target.fields) } }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the Sage request.") }
  }
}

export type SageAddRequestOutcome =
  | { readonly success: true; readonly data: { readonly requestId: string; readonly needsW9: boolean } }
  | { readonly success: false; readonly error: string; readonly exact?: readonly DuplicateMatch[] }

/**
 * Asks to add the record to Sage. Saves the details staff filled in on the
 * Compass record, refuses an exact duplicate, stores close look-alikes for the
 * approver, and notifies them. A person needs their company in Sage, or
 * already asked for.
 */
export async function requestSageAdd(raw: unknown): Promise<SageAddRequestOutcome> {
  try {
    const parsed = sageDirectoryAddInputSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the details." }
    const input = parsed.data
    const context = await orgContext({ feature: directoryFeature(input.kind), action: "update", mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isOfficeStaff(user)) return { success: false, error: "Only office staff can ask to add records to Sage." }
    const target = await loadSageAddTarget(db, organizationId, input.kind, input.entityId)
    if (!target) return { success: false, error: "That record was not found." }
    if (target.inSage) return { success: false, error: `${target.name} is already in Sage.` }
    if (target.openRequest) return { success: false, error: `${target.name} was already asked for: ${SAGE_ADD_STATUS_LABELS[target.openRequest.status]}.` }
    if ("parent" in target && !target.parent.inSage && !target.parent.openRequest) {
      return { success: false, error: `Ask to add ${target.parent.name} to Sage first; then its people can follow.` }
    }

    const duplicates = await duplicatesFor(db, organizationId, target, input.fields)
    if (duplicates.exact.length > 0) {
      const first = duplicates.exact[0]
      const where = first?.source === "sage" ? `Sage already has ${first.name}${first.sageNumber ? ` (#${first.sageNumber})` : ""}` : `Compass already has ${first?.name ?? "this name"}`
      return { success: false, error: `${where}. Link to it or merge instead of adding a duplicate.`, exact: duplicates.exact }
    }

    const now = new Date().toISOString()
    await saveRequestedDetails(db, organizationId, input, now)
    const requestId = crypto.randomUUID()
    try {
      await insertSageDirectoryAddRequest(db, {
        id: requestId, organizationId, kind: input.kind, entityId: input.entityId,
        parentRequestId: "parent" in target ? target.parent.openRequest?.id ?? null : null,
        fieldsJson: JSON.stringify(input.fields),
        vendorType: input.kind === "vendor_company" ? input.vendorType : null,
        form1099: input.kind === "vendor_company" ? input.form1099 : null,
        duplicatesJson: JSON.stringify(duplicates.close),
        status: "pending", requestedByUserId: user.id, requestedAt: now, updatedAt: now,
      }).run()
    } catch {
      return { success: false, error: "Someone just asked for this record. Refresh to see the request." }
    }
    const row = await db.select().from(sageDirectoryAddRequests).where(eq(sageDirectoryAddRequests.id, requestId)).get()
    if (row) {
      await recordSageAddActivity(db, row, user, "requested", `Asked to add ${input.fields.name} to Sage.`, now)
      await notifySageAddApprovers(db, {
        organizationId, requestId, kind: input.kind, name: input.fields.name, requesterName: displayName(user), closeMatches: duplicates.close.length,
      })
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { requestId, needsW9: input.kind === "vendor_company" && input.form1099 === "unknown" } }
  } catch (error) {
    return { success: false, error: message(error, "Could not send the Sage request.") }
  }
}

/** Compass shows what staff filled in right away; Sage gets it once approved. */
async function saveRequestedDetails(
  db: Db,
  organizationId: string,
  input: ReturnType<typeof sageDirectoryAddInputSchema.parse>,
  now: string
): Promise<void> {
  if (input.kind === "vendor_company" || input.kind === "client_company") {
    const { name, addressLine1, addressLine2, city, state, postalCode, phone, email } = input.fields
    const values = { name, addressLine1, addressLine2, city, state, postalCode, phone, address: companyAddressLine(input.fields), updatedAt: now }
    if (input.kind === "vendor_company") {
      await updateVendor(db, { vendorId: input.entityId, organizationId, values: { ...values, primaryEmail: email, email, form1099Status: input.form1099 } })
    } else {
      await updateCustomerById(db, { customerId: input.entityId, values: { ...values, primaryEmail: email, email } })
    }
    return
  }
  const { name, title, phone, cellPhone, email } = input.fields
  const values = { name, title, phone, cellPhone, email, updatedAt: now }
  if (input.kind === "client_person") {
    await updateCustomerPerson(db, { personId: input.entityId, values })
    return
  }
  const person = await db.select({ vendorId: vendorContacts.vendorId }).from(vendorContacts).where(eq(vendorContacts.id, input.entityId)).get()
  if (person) await updateVendorPersonStatement(db, { vendorId: person.vendorId, personId: input.entityId, values })
}

export type SageAddRequestListItem = {
  readonly id: string
  readonly kind: SageDirectoryAddKind
  readonly kindLabel: string
  readonly name: string
  readonly status: SageDirectoryAddStatus
  readonly statusLabel: string
  readonly details: readonly { readonly label: string; readonly value: string }[]
  readonly duplicates: readonly DuplicateMatch[]
  readonly requestedByName: string | null
  readonly requestedAt: string
  readonly reviewedByName: string | null
  readonly reviewNote: string | null
  readonly sageRecordNumber: string | null
  readonly errorMessage: string | null
  readonly canDecide: boolean
  readonly canWithdraw: boolean
}

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  addressLine1: "Address", addressLine2: "Address 2", city: "City", state: "State", postalCode: "ZIP",
  phone: "Phone", cellPhone: "Cell", email: "Email", title: "Title",
}

function requestDetails(row: typeof sageDirectoryAddRequests.$inferSelect): { readonly label: string; readonly value: string }[] {
  let raw: unknown
  try { raw = JSON.parse(row.fieldsJson) } catch { raw = null }
  const details: { label: string; value: string }[] = []
  if (typeof raw === "object" && raw !== null) {
    for (const [key, value] of Object.entries(raw)) {
      const label = DETAIL_LABELS[key]
      if (label && typeof value === "string" && value.trim()) details.push({ label, value })
    }
  }
  if (row.vendorType) details.push({ label: "Sage vendor type", value: row.vendorType })
  if (row.form1099) details.push({ label: "1099", value: row.form1099 === "yes" ? "Yes" : row.form1099 === "no" ? "No" : "Not known yet (W-9 requested)" })
  return details
}

/** Contacts → Sage add requests: open ones and the last month's, with who may decide. */
export async function listSageAddRequests(): Promise<Result<{ readonly rows: readonly SageAddRequestListItem[]; readonly canDecide: boolean }>> {
  try {
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isOfficeStaff(user)) return { success: false, error: "Only office staff can see Sage requests." }
    const [rows, approvers] = await Promise.all([listSageAddRequestRows(db, organizationId), sageAddApprovers(db, organizationId)])
    const decides = approvers.decides(user)
    const userIds = [...new Set(rows.flatMap((row) => [row.requestedByUserId, row.reviewedByUserId]).filter((id): id is string => Boolean(id)))]
    const people = userIds.length === 0 ? [] : await db.select({ id: users.id, email: users.email, displayName: users.displayName, firstName: users.firstName })
      .from(users).where(inArray(users.id, userIds))
    const names = new Map(people.map((person) => [person.id, displayName(person)]))
    return {
      success: true,
      data: {
        canDecide: decides,
        rows: rows.map((row) => ({
          id: row.id, kind: row.kind, kindLabel: SAGE_ADD_KIND_LABELS[row.kind], name: requestName(row),
          status: row.status, statusLabel: SAGE_ADD_STATUS_LABELS[row.status], details: requestDetails(row),
          duplicates: parseStoredDuplicates(row.duplicatesJson),
          requestedByName: row.requestedByUserId ? names.get(row.requestedByUserId) ?? null : null, requestedAt: row.requestedAt,
          reviewedByName: row.reviewedByUserId ? names.get(row.reviewedByUserId) ?? null : null, reviewNote: row.reviewNote,
          sageRecordNumber: row.sageRecordNumber, errorMessage: row.errorMessage,
          canDecide: decides && row.status === "pending",
          canWithdraw: (row.status === "pending" || row.status === "approved") && (decides || row.requestedByUserId === user.id),
        })),
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load Sage requests.") }
  }
}

async function loadRequest(db: Db, organizationId: string, id: string) {
  return db.select().from(sageDirectoryAddRequests)
    .where(and(eq(sageDirectoryAddRequests.id, id), eq(sageDirectoryAddRequests.organizationId, organizationId))).get()
}

/** The approver's decision. Approving queues the record for the Sage writer. */
export async function decideSageAddRequest(
  requestId: string,
  decision: "approve" | "reject",
  note = ""
): Promise<Result<{ readonly status: SageDirectoryAddStatus; readonly notice: string | null }>> {
  try {
    if (decision !== "approve" && decision !== "reject") return { success: false, error: "Choose approve or reject." }
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const approvers = await sageAddApprovers(db, organizationId)
    if (!approvers.decides(user)) return { success: false, error: "Only the company's Sage approver can decide these requests." }
    const request = await loadRequest(db, organizationId, requestId)
    if (!request || request.status !== "pending") return { success: false, error: "This request was already decided." }
    const now = new Date().toISOString()
    const reviewNote = note.trim().slice(0, 1000) || null
    const status: "approved" | "rejected" = decision === "approve" ? "approved" : "rejected"
    const changed = await updateSageDirectoryAddRequest(db, {
      id: request.id, organizationId, fromStatuses: ["pending"],
      values: { status, reviewedByUserId: user.id, reviewedAt: now, reviewNote, completedAt: decision === "reject" ? now : null, updatedAt: now },
    })
    if (changed === 0) return { success: false, error: "This request was already decided." }
    const name = requestName(request)
    const decided = { ...request, status, reviewedByUserId: user.id }
    await recordSageAddActivity(db, decided, user, decision === "approve" ? "approved" : "rejected",
      decision === "approve" ? `Approved adding ${name} to Sage.` : `Did not approve adding ${name} to Sage${reviewNote ? `: ${reviewNote}` : "."}`, now)
    if (request.requestedByUserId !== user.id) {
      await notifySageAddRequester(db, request,
        decision === "approve" ? `${name}: approved for Sage` : `${name}: not approved for Sage`,
        decision === "approve" ? `${displayName(user)} approved adding ${name} to Sage.` : `${displayName(user)} did not approve it${reviewNote ? `: ${reviewNote}` : "."}`)
    }
    let notice: string | null = null
    let finalStatus: SageDirectoryAddStatus = status
    if (decision === "approve") {
      const queued = await queueApprovedSageAdd(db, decided, user.id, now)
      finalStatus = queued.status
      notice = queued.error ?? (queued.status === "approved" ? "It goes to Sage once its company is in Sage." : null)
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { status: finalStatus, notice } }
  } catch (error) {
    return { success: false, error: message(error, "Could not record the decision.") }
  }
}

/** Withdraws a request that hasn't gone to Sage (the requester or the approver). */
export async function withdrawSageAddRequest(requestId: string): Promise<Result<null>> {
  try {
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const request = await loadRequest(db, organizationId, requestId)
    if (!request || !isOpenSageAddStatus(request.status) || request.status === "sent") {
      return { success: false, error: "Only a request that hasn't gone to Sage can be withdrawn." }
    }
    const approvers = await sageAddApprovers(db, organizationId)
    if (request.requestedByUserId !== user.id && !approvers.decides(user)) return actionFailure("Only the requester or the approver can withdraw this request.")
    const now = new Date().toISOString()
    const changed = await updateSageDirectoryAddRequest(db, {
      id: request.id, organizationId, fromStatuses: ["pending", "approved"],
      values: { status: "cancelled", completedAt: now, updatedAt: now },
    })
    if (changed === 0) return { success: false, error: "This request already went to Sage." }
    await recordSageAddActivity(db, request, user, "withdrawn", `Withdrew the request to add ${requestName(request)} to Sage.`, now)
    revalidatePath("/dashboard/contacts")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not withdraw the request.") }
  }
}
