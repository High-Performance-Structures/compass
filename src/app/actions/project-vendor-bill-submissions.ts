"use server"

import { and, asc, eq, inArray, like, ne, notInArray, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectExternalLinks,
  projectOperations,
  projectContacts,
  projectVendorBillSubmissionAttachments,
  projectVendorBillSubmissionLines,
  projectVendorBillSubmissions,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  buildVendorBillFinalPacketPdf,
  type VendorBillDuplicateReview,
} from "@/lib/vendor-bills/final-packet"

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
  readonly duplicateStatus: string
  readonly duplicateSource: string | null
  readonly duplicateMessage: string | null
  readonly duplicateCheckedAt: string | null
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
  readonly canFinalize: boolean
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

type FinalizeVendorBillSubmissionResult =
  | {
      readonly success: true
      readonly stampedFileUrl: string | null
      readonly duplicateStatus: string
      readonly message: string
    }
  | { readonly success: false; readonly error: string }

const EXTERNAL_CONTACT_TYPES = ["subcontractor", "supplier"] as const
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const PAY_REQUESTS_FOLDER_NAME = "03_PayRequests"
const VENDOR_BILL_FOLDER_NAME = "Compass Bill Submissions"
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function googleConfigEnv(env: unknown): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  if (!isRecord(env)) return values

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") values[key] = value
  }

  return values
}

function resolveGoogleUploadEmail(input: {
  readonly userEmail: string
  readonly googleEmail: string | null
  readonly env: unknown
}): string {
  const configuredEmail = envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER")
  if (configuredEmail) return configuredEmail
  if (input.googleEmail) return input.googleEmail
  if (input.userEmail.endsWith("@hps-colorado.com")) return input.userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : "vendor-bill-final-packet.pdf"
}

function drawFolderName(value: string | null): string {
  const cleaned = cleanText(value)
  if (!cleaned) return "Ready for Sage"
  const numeric = cleaned.match(/^\d+$/)
  return numeric ? `Draw ${cleaned.padStart(2, "0")}` : `Draw ${cleaned}`
}

async function resolveProjectDriveFolderId(input: {
  readonly db: Db
  readonly projectId: string
  readonly projectDriveFolderId: string | null
}): Promise<string | null> {
  if (input.projectDriveFolderId) return input.projectDriveFolderId

  const [driveLink] = await input.db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)

  return (
    driveLink?.externalId ??
    driveFolderIdFromUrl(driveLink?.externalUrl ?? null)
  )
}

async function findOrCreateFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly parentFolderId: string
  readonly driveId: string | null
  readonly folderName: string
}): Promise<string> {
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(input.folderName)}'`,
  })
  const existingFolder = result.files[0]
  if (existingFolder) return existingFolder.id

  const folder = await input.client.createFolder(input.googleEmail, {
    name: input.folderName,
    parentId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
  })
  return folder.id
}

async function findOrCreateFinalBillFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly projectFolderId: string
  readonly driveId: string | null
  readonly payRequestNumber: string | null
}): Promise<string> {
  const payRequestsFolderId = await findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: input.projectFolderId,
    driveId: input.driveId,
    folderName: PAY_REQUESTS_FOLDER_NAME,
  })
  const drawFolderId = await findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: payRequestsFolderId,
    driveId: input.driveId,
    folderName: drawFolderName(input.payRequestNumber),
  })
  return findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: drawFolderId,
    driveId: input.driveId,
    folderName: VENDOR_BILL_FOLDER_NAME,
  })
}

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

async function detectVendorBillDuplicate(input: {
  readonly db: Db
  readonly projectId: string
  readonly submissionId: string
  readonly vendorName: string
  readonly billNumber: string | null
}): Promise<VendorBillDuplicateReview> {
  const normalizedBillNumber = cleanText(input.billNumber)
  if (!normalizedBillNumber) {
    return {
      status: "not_checked",
      source: "compass",
      message: "No invoice number was provided, so duplicate detection is limited.",
    }
  }

  const normalizedVendor = input.vendorName.trim().toLowerCase()
  const [compassDuplicate] = await input.db
    .select({
      id: projectVendorBillSubmissions.id,
      vendorName: projectVendorBillSubmissions.vendorName,
      billNumber: projectVendorBillSubmissions.billNumber,
      stampedFileUrl: projectVendorBillSubmissions.stampedFileUrl,
    })
    .from(projectVendorBillSubmissions)
    .where(
      and(
        eq(projectVendorBillSubmissions.projectId, input.projectId),
        ne(projectVendorBillSubmissions.id, input.submissionId),
        eq(projectVendorBillSubmissions.billNumber, normalizedBillNumber),
        sql`lower(trim(${projectVendorBillSubmissions.vendorName})) = ${normalizedVendor}`
      )
    )
    .limit(1)

  if (compassDuplicate) {
    return {
      status: "possible_duplicate",
      source: "compass",
      message: `Possible duplicate: ${compassDuplicate.vendorName} invoice ${compassDuplicate.billNumber} already exists in Compass.`,
    }
  }

  const invoiceSearch = `%${normalizedBillNumber}%`
  const [sageReadModelDuplicate] = await input.db
    .select({
      id: projectOperations.id,
      sourceSystem: projectOperations.sourceSystem,
      sourceRecordType: projectOperations.sourceRecordType,
      sourceRecordNumber: projectOperations.sourceRecordNumber,
      title: projectOperations.title,
      companyName: projectOperations.companyName,
      sageVendorName: projectOperations.sageVendorName,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        inArray(projectOperations.sourceRecordType, [
          "vendor_bill",
          "sage_vendor_bill",
          "accounts_payable_invoice",
        ]),
        or(
          eq(projectOperations.sourceRecordNumber, normalizedBillNumber),
          like(projectOperations.title, invoiceSearch),
          like(projectOperations.description, invoiceSearch),
          like(projectOperations.sagePayloadJson, invoiceSearch)
        )
      )
    )
    .limit(1)

  if (sageReadModelDuplicate) {
    const vendor =
      sageReadModelDuplicate.sageVendorName ??
      sageReadModelDuplicate.companyName ??
      "Sage vendor"
    return {
      status: "possible_duplicate",
      source: "sage_read_model",
      message: `Possible duplicate: ${vendor} invoice ${normalizedBillNumber} appears in ${sageReadModelDuplicate.sourceSystem} ${sageReadModelDuplicate.sourceRecordType}.`,
    }
  }

  return {
    status: "sage_check_pending",
    source: "compass",
    message:
      "No duplicate found in Compass staging. Sage A/P direct lookup is still required before posting.",
  }
}

async function firstOriginalInvoicePdf(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly attachments: readonly {
    readonly mimeType: string | null
    readonly storageId: string | null
  }[]
}): Promise<ArrayBuffer | null> {
  const attachment = input.attachments.find(
    (item) => item.storageId && item.mimeType === "application/pdf"
  )
  if (!attachment?.storageId) return null

  const response = await input.client.downloadFile(
    input.googleEmail,
    attachment.storageId
  )
  if (!response.ok) return null
  return response.arrayBuffer()
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
  const canFinalize =
    isInternal && (await canFeature(user, "bill-submissions", "approve"))

  return {
    isInternal,
    canReview,
    canFinalize,
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
      duplicateStatus: row.duplicateStatus,
      duplicateSource: row.duplicateSource,
      duplicateMessage: row.duplicateMessage,
      duplicateCheckedAt: row.duplicateCheckedAt,
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

export async function finalizeVendorBillSubmission(
  projectId: string,
  submissionId: string
): Promise<FinalizeVendorBillSubmissionResult> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "bill-submissions", "approve")
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Staff access is required." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const [submission] = await db
      .select()
      .from(projectVendorBillSubmissions)
      .where(
        and(
          eq(projectVendorBillSubmissions.id, submissionId),
          eq(projectVendorBillSubmissions.projectId, projectId)
        )
      )
      .limit(1)

    if (!project || !submission) {
      return { success: false, error: "Submission not found." }
    }
    if (submission.reviewStatus !== "ready_for_sage") {
      return {
        success: false,
        error: "Mark this bill ready for Sage before creating the final copy.",
      }
    }

    const [lineRows, attachmentRows] = await Promise.all([
      db
        .select()
        .from(projectVendorBillSubmissionLines)
        .where(
          and(
            eq(projectVendorBillSubmissionLines.submissionId, submissionId),
            eq(projectVendorBillSubmissionLines.projectId, projectId)
          )
        )
        .orderBy(asc(projectVendorBillSubmissionLines.lineNumber)),
      db
        .select()
        .from(projectVendorBillSubmissionAttachments)
        .where(
          and(
            eq(projectVendorBillSubmissionAttachments.submissionId, submissionId),
            eq(projectVendorBillSubmissionAttachments.projectId, projectId)
          )
        )
        .orderBy(asc(projectVendorBillSubmissionAttachments.createdAt)),
    ])

    if (lineRows.length === 0) {
      return { success: false, error: "Add at least one coding line first." }
    }
    if (lineRows.some((line) => !cleanText(line.costCode))) {
      return { success: false, error: "Every coding line needs a cost code." }
    }

    const duplicateReview = await detectVendorBillDuplicate({
      db,
      projectId,
      submissionId,
      vendorName: submission.vendorName,
      billNumber: submission.billNumber,
    })

    const [auth] = await db.select().from(googleAuth).limit(1)
    if (!auth) {
      return { success: false, error: "Google Drive is not connected." }
    }

    const projectFolderId = await resolveProjectDriveFolderId({
      db,
      projectId,
      projectDriveFolderId: project.googleDriveFolderId,
    })
    if (!projectFolderId) {
      return {
        success: false,
        error: "Map this project to Google Drive before saving the final copy.",
      }
    }

    const config = getGoogleConfig(googleConfigEnv(env))
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })
    const googleEmail = resolveGoogleUploadEmail({
      userEmail: user.email,
      googleEmail: user.googleEmail,
      env,
    })
    const originalInvoicePdf = await firstOriginalInvoicePdf({
      client,
      googleEmail,
      attachments: attachmentRows,
    })

    const now = new Date().toISOString()
    const packetBytes = await buildVendorBillFinalPacketPdf({
      generatedAt: now,
      generatedBy: user.displayName ?? user.email,
      project: {
        projectNumber: project.projectNumber,
        name: project.name,
        sageJobNumber: project.sageJobNumber,
      },
      submission: {
        vendorName: submission.vendorName,
        vendorEmail: submission.vendorEmail,
        billNumber: submission.billNumber,
        billDate: submission.billDate,
        dueDate: submission.dueDate,
        description: submission.description,
        totalAmount: submission.totalAmount,
        payRequestNumber: submission.payRequestNumber,
        payRequestDate: submission.payRequestDate,
        isChangeOrder: submission.isChangeOrder,
        changeOrderNumber: submission.changeOrderNumber,
        reviewNotes: submission.reviewNotes,
      },
      lines: lineRows.map((line) => ({
        lineNumber: line.lineNumber,
        phaseCode: line.phaseCode,
        costCode: line.costCode,
        description: line.description,
        amount: line.amount,
      })),
      attachments: attachmentRows.map((attachment) => ({
        fileName: attachment.fileName,
        storageUrl: attachment.storageUrl,
      })),
      duplicateReview,
      originalInvoicePdf,
    })

    const folderId = await findOrCreateFinalBillFolder({
      client,
      googleEmail,
      projectFolderId,
      driveId: auth.sharedDriveId,
      payRequestNumber: submission.payRequestNumber,
    })
    const projectPrefix = project.projectNumber ?? project.name
    const billPart = submission.billNumber ?? submission.id.slice(0, 8)
    const fileName = safeFileName(
      `${projectPrefix} ${submission.vendorName} ${billPart} ${drawFolderName(
        submission.payRequestNumber
      )} final packet.pdf`
    )
    const packetBuffer = new ArrayBuffer(packetBytes.byteLength)
    new Uint8Array(packetBuffer).set(packetBytes)
    const driveFile = await client.uploadFile(googleEmail, {
      name: fileName,
      mimeType: "application/pdf",
      parentId: folderId,
      driveId: auth.sharedDriveId ?? undefined,
      data: new Blob([packetBuffer], { type: "application/pdf" }),
    })

    const duplicateBlocksSage = duplicateReview.status === "possible_duplicate"
    await db
      .update(projectVendorBillSubmissions)
      .set({
        stampedFileId: driveFile.id,
        stampedFileUrl: driveFile.webViewLink ?? null,
        stampedAt: now,
        duplicateStatus: duplicateReview.status,
        duplicateSource: duplicateReview.source,
        duplicateMessage: duplicateReview.message,
        duplicateCheckedAt: now,
        sageWriteStatus: duplicateBlocksSage ? "duplicate_review" : "ready",
        syncStatus: duplicateBlocksSage ? "duplicate_review" : "pending_sage",
        updatedAt: now,
      })
      .where(eq(projectVendorBillSubmissions.id, submissionId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/bill-submissions`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)

    return {
      success: true,
      stampedFileUrl: driveFile.webViewLink ?? null,
      duplicateStatus: duplicateReview.status,
      message:
        duplicateReview.status === "possible_duplicate"
          ? "Final copy saved, but this bill needs duplicate review before Sage posting."
          : "Final copy saved and queued for Sage review.",
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create final bill copy.",
    }
  }
}
