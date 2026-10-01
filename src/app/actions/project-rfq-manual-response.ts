"use server"

import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import {
  projectRfqBidApprovals,
  projectRfqManualResponseEvents,
} from "@/db/schema-rfqs"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { rfqResponseCoversScope } from "@/lib/rfqs/bid-workflow"
import {
  parsePortalRfqPayload,
  withPortalRfqVendorResponse,
  type PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

export type ManualRfqResponseInput = {
  readonly expectedUpdatedAt: string
  readonly decision: "quote" | "decline"
  readonly receivedVia: "email" | "phone" | "other"
  readonly receivedDate: string
  readonly responderName: string
  readonly sourceReference: string | null
  readonly amount: number | null
  readonly lines: readonly {
    readonly lineNumber: number
    readonly amount: number | null
    readonly notes: string | null
  }[]
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
}

export type ManualRfqResponseEventItem = {
  readonly id: string
  readonly rfqOperationId: string
  readonly receivedVia: string
  readonly sourceReference: string | null
  readonly recordedByName: string
  readonly recordedAt: string
  readonly responseJson: string
}

type ManualRfqResponseResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

function clean(value: string | null, maxLength: number): string | null {
  const result = value?.trim() ?? ""
  if (result.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer.`)
  return result || null
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function getProjectRfqManualResponseEvents(
  projectId: string
): Promise<readonly ManualRfqResponseEventItem[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "rfqs", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, organizationId)
  )).limit(1).then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")
  const rows = await db.select().from(projectRfqManualResponseEvents)
    .where(eq(projectRfqManualResponseEvents.projectId, projectId))
    .orderBy(desc(projectRfqManualResponseEvents.recordedAt))
  return rows.map((row) => ({
    id: row.id,
    rfqOperationId: row.rfqOperationId,
    receivedVia: row.receivedVia,
    sourceReference: row.sourceReference,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt,
    responseJson: row.responseJson,
  }))
}

export async function saveManualProjectRfqResponse(
  projectId: string,
  rfqId: string,
  input: ManualRfqResponseInput
): Promise<ManualRfqResponseResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "rfqs", "update")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, organizationId)
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!project) return { success: false, error: "Project not found." }
    const rfq = await db.select().from(projectOperations).where(and(
      eq(projectOperations.id, rfqId),
      eq(projectOperations.projectId, projectId),
      eq(projectOperations.sourceRecordType, "rfq")
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!rfq) return { success: false, error: "RFQ not found." }
    if (rfq.updatedAt !== input.expectedUpdatedAt) {
      return { success: false, error: "This RFQ changed. Refresh before recording the response." }
    }
    if ((input.decision !== "quote" && input.decision !== "decline") ||
      (input.receivedVia !== "email" && input.receivedVia !== "phone" && input.receivedVia !== "other") ||
      !Array.isArray(input.lines)) {
      return { success: false, error: "Enter a valid vendor response." }
    }
    if (!["draft", "sent", "response_received", "declined"].includes(rfq.status)) {
      return { success: false, error: "This RFQ no longer accepts response changes." }
    }
    const approval = await db.select({ id: projectRfqBidApprovals.id })
      .from(projectRfqBidApprovals)
      .where(eq(projectRfqBidApprovals.rfqOperationId, rfqId))
      .limit(1).then((rows) => rows[0] ?? null)
    if (approval) return { success: false, error: "Approved RFQ pricing cannot be changed." }
    const responderName = clean(input.responderName, 240)
    if (!responderName) return { success: false, error: "Enter the vendor contact or company name." }
    if (!validDate(input.receivedDate)) {
      return { success: false, error: "Enter a valid received date." }
    }
    const validUntil = clean(input.validUntil, 10)
    if (validUntil && !validDate(validUntil)) {
      return { success: false, error: "Enter a valid quote expiration date." }
    }
    const payload = parsePortalRfqPayload(rfq.sagePayloadJson)
    const lines = input.decision === "quote" ? input.lines.map((line) => ({
      lineNumber: line.lineNumber,
      amount: line.amount === null ? null : Math.round(line.amount * 100) / 100,
      notes: clean(line.notes, 2_000),
    })) : []
    if (input.decision === "quote") {
      if (lines.some((line) => !Number.isSafeInteger(line.lineNumber) || line.lineNumber < 1 || line.amount === null || !Number.isFinite(line.amount) || line.amount < 0) ||
        !rfqResponseCoversScope(payload.scopeItems.map((line) => line.lineNumber), lines)) {
        return { success: false, error: "Enter a valid price for every RFQ scope line." }
      }
    }
    const lineTotalCents = lines.reduce((total, line) => total + Math.round((line.amount ?? 0) * 100), 0)
    if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount < 0)) {
      return { success: false, error: "Enter a valid quoted total." }
    }
    const enteredTotalCents = input.amount === null ? null : Math.round(input.amount * 100)
    if (input.decision === "quote" && (
      (payload.scopeItems.length > 0 && enteredTotalCents !== lineTotalCents) ||
      (payload.scopeItems.length === 0 && (enteredTotalCents === null || enteredTotalCents < 0))
    )) {
      return { success: false, error: "Quoted total must equal the scope line prices." }
    }
    const amount = input.decision === "quote"
      ? (payload.scopeItems.length > 0 ? lineTotalCents : enteredTotalCents ?? 0) / 100
      : null
    const now = new Date().toISOString()
    const response: PortalRfqVendorResponse = {
      decision: input.decision,
      amount,
      lines: lines.flatMap((line) => line.amount === null ? [] : [{
        lineNumber: line.lineNumber, amount: line.amount, notes: line.notes,
      }]),
      leadTime: clean(input.leadTime, 240),
      validUntil,
      notes: clean(input.notes, 10_000),
      responderUserId: `manual:${user.id}`,
      responderName,
      responderCompany: rfq.companyName,
      submittedAt: `${input.receivedDate}T12:00:00.000Z`,
    }
    const eventId = crypto.randomUUID()
    const actorName = user.displayName?.trim() || user.email
    const receivedVia = input.receivedVia
    if (!["email", "phone", "other"].includes(receivedVia)) {
      return { success: false, error: "Choose how the response was received." }
    }
    const sourceReference = clean(input.sourceReference, 2_000)
    const previousResponseJson = payload.vendorResponse ? JSON.stringify(payload.vendorResponse) : null
    const responseJson = JSON.stringify(response)
    const responseStatus = input.decision === "quote" ? "response_received" : "declined"
    const insertEvent = db.insert(projectRfqManualResponseEvents).select(sql`SELECT
      ${eventId}, ${projectId}, ${rfqId}, ${receivedVia}, ${sourceReference},
      ${previousResponseJson}, ${responseJson}, ${user.id}, ${actorName}, ${now}
      FROM ${projectOperations}
      WHERE ${projectOperations.id} = ${rfqId}
        AND ${projectOperations.projectId} = ${projectId}
        AND ${projectOperations.updatedAt} = ${rfq.updatedAt}
        AND ${projectOperations.status} IN ('draft', 'sent', 'response_received', 'declined')
        AND NOT EXISTS (
          SELECT 1 FROM ${projectRfqBidApprovals}
          WHERE ${projectRfqBidApprovals.rfqOperationId} = ${rfqId}
        )`)
    await db.batch([
      insertEvent,
      db.update(projectOperations).set({
        status: responseStatus,
        amount,
        sagePayloadJson: withPortalRfqVendorResponse(rfq.sagePayloadJson, response),
        updatedAt: now,
      }).where(and(
        eq(projectOperations.id, rfqId),
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.updatedAt, rfq.updatedAt),
        sql`EXISTS (SELECT 1 FROM ${projectRfqManualResponseEvents}
          WHERE ${projectRfqManualResponseEvents.id} = ${eventId})`
      )),
    ])
    const saved = await db.select({ id: projectRfqManualResponseEvents.id, updatedAt: projectOperations.updatedAt })
      .from(projectRfqManualResponseEvents)
      .innerJoin(projectOperations, eq(projectOperations.id, projectRfqManualResponseEvents.rfqOperationId))
      .where(eq(projectRfqManualResponseEvents.id, eventId))
      .limit(1).then((rows) => rows[0] ?? null)
    if (!saved || saved.updatedAt !== now) {
      return { success: false, error: "This RFQ changed. Refresh before recording the response." }
    }
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    return { success: true, id: eventId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to record RFQ response." }
  }
}
