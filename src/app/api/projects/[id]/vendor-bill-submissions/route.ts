import { and, eq, inArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import {
  projectContacts,
  projectExternalLinks,
  projects,
  projectVendorBillSubmissionAttachments,
  projectVendorBillSubmissionLines,
  projectVendorBillSubmissions,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const VENDOR_BILL_FOLDER_NAME = "Vendor Bill Submissions"
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

type SubmitVendorBillResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ParsedLine = {
  readonly description: string | null
  readonly amount: number
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly targetProjectId: string | null
}

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  )
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "vendor-bill-attachment"
}

function cleanText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(value: FormDataEntryValue | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value !== "string") return 0
  const amount = Number(value.replace(/[$,]/g, "").trim())
  return Number.isFinite(amount) ? amount : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseLines(value: string | null): readonly ParsedLine[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []

  return parsed.filter(isRecord).map((line) => ({
    description: cleanString(line.description),
    amount: cleanAmount(line.amount),
    costCode: cleanString(line.costCode),
    phaseCode: cleanString(line.phaseCode),
    targetProjectId: cleanString(line.targetProjectId),
  }))
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

function envString(env: Record<string, string>, key: string): string | null {
  const value = env[key]
  return value && value.trim().length > 0 ? value : null
}

function resolveGoogleUploadEmail(input: {
  readonly userEmail: string
  readonly googleEmail: string | null
  readonly env: Record<string, string>
}): string {
  const configuredEmail = envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER")
  if (configuredEmail) return configuredEmail
  if (input.googleEmail) return input.googleEmail
  if (input.userEmail.endsWith("@hps-colorado.com")) return input.userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

async function resolveProjectDriveFolderId(input: {
  readonly db: ReturnType<typeof getDb>
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

async function findOrCreateVendorBillFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly parentFolderId: string
  readonly driveId: string | null
}): Promise<string> {
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(VENDOR_BILL_FOLDER_NAME)}'`,
  })
  const existingFolder = result.files[0]
  if (existingFolder) return existingFolder.id

  const folder = await input.client.createFolder(input.googleEmail, {
    name: VENDOR_BILL_FOLDER_NAME,
    parentId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
  })
  return folder.id
}

async function getMatchingExternalContact(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly userEmail: string
}) {
  const normalizedEmail = input.userEmail.trim().toLowerCase()
  if (!normalizedEmail) return null

  const [contact] = await input.db
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
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.active, true),
        inArray(projectContacts.contactType, ["subcontractor", "supplier"]),
        sql`lower(trim(${projectContacts.email})) = ${normalizedEmail}`
      )
    )
    .limit(1)

  return contact ?? null
}

export async function POST(
  request: NextRequest,
  { params }: { readonly params: Promise<{ readonly id: string }> }
): Promise<NextResponse<SubmitVendorBillResult>> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "bill-submissions", "create")

    if (isDemoUser(user.id)) {
      return NextResponse.json(
        { success: false, error: "Demo mode is read-only." },
        { status: 403 }
      )
    }

    const { id: projectId } = await params
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const projectAccess = await assertProjectAccess(db, user, projectId)
    const isInternal = isInternalStaffRole(user.role)
    const matchingContact = isInternal
      ? null
      : await getMatchingExternalContact({ db, projectId, userEmail: user.email })

    if (!isInternal && !matchingContact) {
      return NextResponse.json(
        {
          success: false,
          error: "Your account is not linked to this project vendor list.",
        },
        { status: 403 }
      )
    }

    const [project] = await db
      .select({
        id: projects.id,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.id, projectAccess.id))
      .limit(1)

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      )
    }

    const formData = await request.formData()
    const vendorName =
      cleanText(formData.get("vendorName")) ??
      matchingContact?.companyName ??
      matchingContact?.displayName ??
      user.displayName ??
      user.email
    const vendorEmail = cleanText(formData.get("vendorEmail")) ?? user.email
    const billNumber = cleanText(formData.get("billNumber"))
    const billDate = cleanText(formData.get("billDate"))
    const dueDate = cleanText(formData.get("dueDate"))
    const description = requiredText(formData.get("description"), "Description")
    const lines = parseLines(cleanText(formData.get("linesJson")))
    if (lines.length === 0) {
      return NextResponse.json(
        { success: false, error: "Add at least one bill line." },
        { status: 400 }
      )
    }

    const files = formData.getAll("files").filter(isFile)
    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      return NextResponse.json(
        {
          success: false,
          error: `${invalidFile.name} is larger than 50 MB.`,
        },
        { status: 400 }
      )
    }

    const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0)
    const now = new Date().toISOString()
    const submissionId = crypto.randomUUID()

    const uploadedFiles: readonly {
      readonly fileName: string
      readonly mimeType: string | null
      readonly fileSize: number
      readonly storageId: string | null
      readonly storageUrl: string | null
      readonly storageStatus: string
    }[] =
      files.length > 0
        ? await (async () => {
            const [auth] = await db.select().from(googleAuth).limit(1)
            if (!auth) {
              throw new Error("Google Drive is not connected.")
            }

            const projectFolderId = await resolveProjectDriveFolderId({
              db,
              projectId,
              projectDriveFolderId: project.googleDriveFolderId,
            })
            if (!projectFolderId) {
              throw new Error(
                "Map this project to Google Drive before attaching bill files."
              )
            }

            const config = getGoogleConfig(envRecord)
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
              env: envRecord,
            })
            const folderId = await findOrCreateVendorBillFolder({
              client,
              googleEmail,
              parentFolderId: projectFolderId,
              driveId: auth.sharedDriveId,
            })

            const uploaded: {
              readonly fileName: string
              readonly mimeType: string | null
              readonly fileSize: number
              readonly storageId: string | null
              readonly storageUrl: string | null
              readonly storageStatus: string
            }[] = []
            for (const file of files) {
              const driveFile = await client.uploadFile(googleEmail, {
                name: safeFileName(file.name),
                mimeType: file.type || "application/octet-stream",
                parentId: folderId,
                driveId: auth.sharedDriveId ?? undefined,
                data: file,
              })
              uploaded.push({
                fileName: driveFile.name,
                mimeType: driveFile.mimeType ?? file.type,
                fileSize: Number(driveFile.size ?? file.size),
                storageId: driveFile.id,
                storageUrl: driveFile.webViewLink ?? null,
                storageStatus: "uploaded",
              })
            }
            return uploaded
          })()
        : []

    await db.insert(projectVendorBillSubmissions).values({
      id: submissionId,
      projectId,
      submittedBy: user.id,
      projectContactId: matchingContact?.id ?? null,
      sourceSystem: "compass",
      sourceRecordId: billNumber,
      vendorName,
      vendorEmail,
      billNumber,
      billDate,
      dueDate,
      description,
      totalAmount,
      status: "submitted",
      reviewStatus: "needs_review",
      sageWriteStatus: "not_ready",
      syncStatus: "compass_intake",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(projectVendorBillSubmissionLines).values(
      lines.map((line, index) => ({
        id: crypto.randomUUID(),
        submissionId,
        projectId,
        lineNumber: index + 1,
        targetProjectId: line.targetProjectId,
        phaseCode: line.phaseCode,
        costCode: line.costCode,
        description: line.description,
        amount: line.amount,
        reviewStatus: line.costCode ? "coded" : "needs_coding",
        createdAt: now,
        updatedAt: now,
      }))
    )

    if (uploadedFiles.length > 0) {
      await db.insert(projectVendorBillSubmissionAttachments).values(
        uploadedFiles.map((file) => ({
          id: crypto.randomUUID(),
          submissionId,
          projectId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          storageProvider: "google_drive",
          storageId: file.storageId,
          storageUrl: file.storageUrl,
          storageStatus: file.storageStatus,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/bill-submissions`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    return NextResponse.json({ success: true, id: submissionId })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to submit vendor bill.",
      },
      { status: 500 }
    )
  }
}
