"use server"

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectContacts,
  projectVendorBillSubmissionAttachments,
  projectVendorBillSubmissionLines,
  projectVendorBillSubmissions,
  sageCostCodes,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

export type VendorBillCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionLabel: string
}

export type VendorBillSubmitterContact = {
  readonly id: string
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
  readonly contactType: string
}

export type VendorBillSubmissionAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageUrl: string | null
}

export type VendorBillSubmissionLineItem = {
  readonly id: string
  readonly lineNumber: number
  readonly targetProjectId: string | null
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly description: string | null
  readonly amount: number
  readonly reviewStatus: string
}

export type VendorBillSubmissionItem = {
  readonly id: string
  readonly vendorName: string
  readonly vendorEmail: string | null
  readonly billNumber: string | null
  readonly billDate: string | null
  readonly dueDate: string | null
  readonly description: string | null
  readonly totalAmount: number
  readonly status: string
  readonly reviewStatus: string
  readonly reviewNotes: string | null
  readonly payRequestNumber: string | null
  readonly payRequestDate: string | null
  readonly isChangeOrder: boolean
  readonly changeOrderNumber: string | null
  readonly stampedFileUrl: string | null
  readonly stampedAt: string | null
  readonly sageWriteStatus: string
  readonly syncStatus: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lines: readonly VendorBillSubmissionLineItem[]
  readonly attachments: readonly VendorBillSubmissionAttachmentItem[]
}

export type ProjectVendorBillSubmissionContext = {
  readonly isInternal: boolean
  readonly canReview: boolean
  readonly matchingContact: VendorBillSubmitterContact | null
  readonly costCodes: readonly VendorBillCostCodeOption[]
  readonly submissions: readonly VendorBillSubmissionItem[]
}

export type VendorBillSubmissionCodingLineInput = {
  readonly id: string
  readonly description: string | null
  readonly amount: number
  readonly costCode: string | null
  readonly phaseCode: string | null
}

export type UpdateVendorBillSubmissionCodingInput = {
  readonly reviewStatus: string
  readonly reviewNotes: string | null
  readonly payRequestNumber: string | null
  readonly payRequestDate: string | null
  readonly isChangeOrder: boolean
  readonly changeOrderNumber: string | null
  readonly lines: readonly VendorBillSubmissionCodingLineInput[]
}

type ActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

const EXTERNAL_CONTACT_TYPES = ["subcontractor", "supplier"] as const

async function getBillSubmissionAccess(projectId: string): Promise<{
  readonly db: Db
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly isInternal: boolean
}> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "bill-submissions", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)

  return { db, user, isInternal: isInternalStaffRole(user.role) }
}

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized.length > 0 ? normalized : null
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function finiteAmount(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function normalizedReviewStatus(value: string): string {
  switch (value) {
    case "needs_review":
    case "needs_coding":
    case "ready_for_sage":
    case "rejected":
      return value
    default:
      return "needs_review"
  }
}

function shouldUseCostCode(row: {
  readonly code: string
  readonly displayLabel: string
  readonly description: string
}): boolean {
  const haystack = `${row.code} ${row.displayLabel} ${row.description}`.toLowerCase()
  return !haystack.includes("clin")
}

async function getMatchingExternalContact(
  db: Db,
  projectId: string,
  email: string
): Promise<VendorBillSubmitterContact | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  const [contact] = await db
    .select({
      id: projectContacts.id,
      displayName: projectContacts.displayName,
      companyName: projectContacts.companyName,
      email: projectContacts.email,
      contactType: projectContacts.contactType,
    })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.active, true),
        inArray(projectContacts.contactType, EXTERNAL_CONTACT_TYPES),
        sql`lower(trim(${projectContacts.email})) = ${normalizedEmail}`
      )
    )
    .orderBy(asc(projectContacts.displayName))
    .limit(1)

  return contact ?? null
}

async function getCostCodeOptions(db: Db): Promise<readonly VendorBillCostCodeOption[]> {
  const rows = await db
    .select({
      code: sageCostCodes.code,
      description: sageCostCodes.description,
      displayLabel: sageCostCodes.displayLabel,
      divisionCode: sageCostCodes.divisionCode,
      divisionDisplayLabel: sageCostCodes.divisionDisplayLabel,
    })
    .from(sageCostCodes)
    .where(eq(sageCostCodes.active, true))
    .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel))

  return rows.filter(shouldUseCostCode).map((row) => ({
    value: row.code,
    label: row.displayLabel,
    description: row.description,
    divisionCode: row.divisionCode,
    divisionLabel: row.divisionDisplayLabel,
  }))
}

function submissionVisibilityCondition(input: {
  readonly isInternal: boolean
  readonly userId: string
  readonly matchingContact: VendorBillSubmitterContact | null
}) {
  if (input.isInternal) return undefined
  if (input.matchingContact) {
    return sql`(${projectVendorBillSubmissions.submittedBy} = ${input.userId} or ${projectVendorBillSubmissions.projectContactId} = ${input.matchingContact.id})`
  }
  return eq(projectVendorBillSubmissions.submittedBy, input.userId)
}

export async function getProjectVendorBillSubmissionContext(
  projectId: string
): Promise<ProjectVendorBillSubmissionContext> {
  const { db, user, isInternal } = await getBillSubmissionAccess(projectId)
  const [costCodes, matchingContact] = await Promise.all([
    getCostCodeOptions(db),
    isInternal ? Promise.resolve(null) : getMatchingExternalContact(db, projectId, user.email),
  ])

  const visibilityCondition = submissionVisibilityCondition({
    isInternal,
    userId: user.id,
    matchingContact,
  })

  const submissionWhere = visibilityCondition
    ? and(eq(projectVendorBillSubmissions.projectId, projectId), visibilityCondition)
    : eq(projectVendorBillSubmissions.projectId, projectId)

  const submissionRows = await db
    .select()
    .from(projectVendorBillSubmissions)
    .where(submissionWhere)
    .orderBy(
      asc(projectVendorBillSubmissions.reviewStatus),
      asc(projectVendorBillSubmissions.createdAt)
    )

  const submissionIds = submissionRows.map((row) => row.id)
  const [lineRows, attachmentRows] =
    submissionIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(projectVendorBillSubmissionLines)
            .where(inArray(projectVendorBillSubmissionLines.submissionId, submissionIds))
            .orderBy(asc(projectVendorBillSubmissionLines.lineNumber)),
          db
            .select()
            .from(projectVendorBillSubmissionAttachments)
            .where(
              inArray(projectVendorBillSubmissionAttachments.submissionId, submissionIds)
            )
            .orderBy(asc(projectVendorBillSubmissionAttachments.createdAt)),
        ])
      : [[], []]

  const linesBySubmission = new Map<string, VendorBillSubmissionLineItem[]>()
  for (const row of lineRows) {
    const lines = linesBySubmission.get(row.submissionId) ?? []
    lines.push({
      id: row.id,
      lineNumber: row.lineNumber,
      targetProjectId: row.targetProjectId,
      phaseCode: row.phaseCode,
      costCode: row.costCode,
      description: row.description,
      amount: row.amount,
      reviewStatus: row.reviewStatus,
    })
    linesBySubmission.set(row.submissionId, lines)
  }

  const attachmentsBySubmission = new Map<string, VendorBillSubmissionAttachmentItem[]>()
  for (const row of attachmentRows) {
    const attachments = attachmentsBySubmission.get(row.submissionId) ?? []
    attachments.push({
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      storageUrl: row.storageUrl,
    })
    attachmentsBySubmission.set(row.submissionId, attachments)
  }

  const canReview =
    isInternal &&
    ((await canFeature(user, "bill-submissions", "update")) ||
      (await canFeature(user, "bill-submissions", "approve")))

  return {
    isInternal,
    canReview,
    matchingContact,
    costCodes,
    submissions: submissionRows.map((row) => ({
      id: row.id,
      vendorName: row.vendorName,
      vendorEmail: row.vendorEmail,
      billNumber: row.billNumber,
      billDate: row.billDate,
      dueDate: row.dueDate,
      description: row.description,
      totalAmount: row.totalAmount,
      status: row.status,
      reviewStatus: row.reviewStatus,
      reviewNotes: row.reviewNotes,
      payRequestNumber: row.payRequestNumber,
      payRequestDate: row.payRequestDate,
      isChangeOrder: row.isChangeOrder,
      changeOrderNumber: row.changeOrderNumber,
      stampedFileUrl: row.stampedFileUrl,
      stampedAt: row.stampedAt,
      sageWriteStatus: row.sageWriteStatus,
      syncStatus: row.syncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines: linesBySubmission.get(row.id) ?? [],
      attachments: attachmentsBySubmission.get(row.id) ?? [],
    })),
  }
}

export async function updateVendorBillSubmissionCoding(
  projectId: string,
  submissionId: string,
  input: UpdateVendorBillSubmissionCodingInput
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "bill-submissions", "update")
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Staff access is required." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)

    const [submission] = await db
      .select({ id: projectVendorBillSubmissions.id })
      .from(projectVendorBillSubmissions)
      .where(
        and(
          eq(projectVendorBillSubmissions.id, submissionId),
          eq(projectVendorBillSubmissions.projectId, projectId)
        )
      )
      .limit(1)

    if (!submission) return { success: false, error: "Submission not found." }
    if (input.lines.length === 0) {
      return { success: false, error: "At least one coding line is required." }
    }

    const now = new Date().toISOString()
    let totalAmount = 0
    const retainedLineIds = input.lines
      .map((line) => line.id)
      .filter((id) => !id.startsWith("new-"))

    if (retainedLineIds.length > 0) {
      await db
        .delete(projectVendorBillSubmissionLines)
        .where(
          and(
            eq(projectVendorBillSubmissionLines.submissionId, submissionId),
            eq(projectVendorBillSubmissionLines.projectId, projectId),
            notInArray(projectVendorBillSubmissionLines.id, retainedLineIds)
          )
        )
    }

    if (retainedLineIds.length === 0) {
      await db
        .delete(projectVendorBillSubmissionLines)
        .where(
          and(
            eq(projectVendorBillSubmissionLines.submissionId, submissionId),
            eq(projectVendorBillSubmissionLines.projectId, projectId)
          )
        )
    }

    for (const line of input.lines) {
      const amount = finiteAmount(line.amount)
      totalAmount += amount
      const values = {
        description: cleanText(line.description),
        amount,
        costCode: cleanText(line.costCode),
        phaseCode: cleanText(line.phaseCode),
        reviewStatus: cleanText(line.costCode) ? "coded" : "needs_coding",
        updatedAt: now,
      }

      if (line.id.startsWith("new-")) {
        await db.insert(projectVendorBillSubmissionLines).values({
          id: crypto.randomUUID(),
          submissionId,
          projectId,
          lineNumber: input.lines.indexOf(line) + 1,
          targetProjectId: null,
          createdAt: now,
          ...values,
        })
      } else {
        await db
          .update(projectVendorBillSubmissionLines)
          .set({
            ...values,
            lineNumber: input.lines.indexOf(line) + 1,
          })
          .where(
            and(
              eq(projectVendorBillSubmissionLines.id, line.id),
              eq(projectVendorBillSubmissionLines.submissionId, submissionId),
              eq(projectVendorBillSubmissionLines.projectId, projectId)
            )
          )
      }
    }

    const reviewStatus = normalizedReviewStatus(input.reviewStatus)
    await db
      .update(projectVendorBillSubmissions)
      .set({
        totalAmount,
        reviewStatus,
        reviewNotes: cleanText(input.reviewNotes),
        payRequestNumber: cleanText(input.payRequestNumber),
        payRequestDate: cleanText(input.payRequestDate),
        isChangeOrder: input.isChangeOrder,
        changeOrderNumber: input.isChangeOrder
          ? cleanText(input.changeOrderNumber)
          : null,
        reviewedBy: user.id,
        reviewedAt: now,
        sageWriteStatus: reviewStatus === "ready_for_sage" ? "ready" : "not_ready",
        syncStatus:
          reviewStatus === "ready_for_sage" ? "pending_sage" : "compass_intake",
        updatedAt: now,
      })
      .where(eq(projectVendorBillSubmissions.id, submissionId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/bill-submissions`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update submission.",
    }
  }
}
