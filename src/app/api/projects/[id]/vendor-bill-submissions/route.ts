import { and, eq, inArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import {
  organizationMembers,
  projectContacts,
  projectExternalLinks,
  projectRoleAssignments,
  projects,
  projectVendorBillSubmissionAttachments,
  projectVendorBillSubmissionLines,
  projectVendorBillSubmissions,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import {
  channelMembers,
  channelReadState,
  channels,
  messageMentions,
  messages,
} from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { DriveClient } from "@/lib/google/client/drive-client"
import { createNotificationEvent } from "@/lib/notifications/events"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const PAY_REQUESTS_FOLDER_NAME = "03_PayRequests"
const VENDOR_BILL_FOLDER_NAME = "Compass Bill Submissions"
const UNCODED_BILL_FOLDER_NAME = "Uncoded"
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"
const PROJECT_ADMINISTRATOR_ROLE_ID = "project-administrator"

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function channelSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return slug.length > 0 ? slug : "project"
}

function projectChannelName(project: {
  readonly projectNumber: string | null
  readonly name: string
}): string {
  const source = project.projectNumber ?? project.name
  return `${channelSlug(source)}-team`
}

function projectLabel(project: {
  readonly projectNumber: string | null
  readonly name: string
}): string {
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
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

async function findOrCreateUncodedBillFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly projectFolderId: string
  readonly driveId: string | null
}): Promise<string> {
  const payRequestsFolderId = await findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: input.projectFolderId,
    driveId: input.driveId,
    folderName: PAY_REQUESTS_FOLDER_NAME,
  })
  const compassBillFolderId = await findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: payRequestsFolderId,
    driveId: input.driveId,
    folderName: VENDOR_BILL_FOLDER_NAME,
  })
  return findOrCreateFolder({
    client: input.client,
    googleEmail: input.googleEmail,
    parentFolderId: compassBillFolderId,
    driveId: input.driveId,
    folderName: UNCODED_BILL_FOLDER_NAME,
  })
}

async function ensureChannelMembership(input: {
  readonly db: ReturnType<typeof getDb>
  readonly channelId: string
  readonly userId: string
  readonly role: "owner" | "moderator" | "member"
}): Promise<void> {
  const existing = await input.db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, input.channelId),
        eq(channelMembers.userId, input.userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) return

  const now = new Date().toISOString()
  await input.db.insert(channelMembers).values({
    id: crypto.randomUUID(),
    channelId: input.channelId,
    userId: input.userId,
    role: input.role,
    notifyLevel: "all",
    joinedAt: now,
  })
  await input.db.insert(channelReadState).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    channelId: input.channelId,
    lastReadMessageId: null,
    lastReadAt: now,
    unreadCount: 0,
  })
}

async function ensureProjectStaffChannel(input: {
  readonly db: ReturnType<typeof getDb>
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly organizationId: string
  }
  readonly createdByUserId: string
}): Promise<string> {
  const existing = await input.db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, input.project.organizationId),
        eq(channels.projectId, input.project.id),
        eq(channels.type, "text"),
        eq(channels.audience, "staff"),
        sql`${channels.archivedAt} IS NULL`
      )
    )
    .orderBy(channels.createdAt)
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) return existing.id

  const now = new Date().toISOString()
  const channelId = crypto.randomUUID()
  await input.db.insert(channels).values({
    id: channelId,
    name: projectChannelName(input.project),
    type: "text",
    description: "Project staff conversation",
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    categoryId: null,
    isPrivate: false,
    audience: "staff",
    createdBy: input.createdByUserId,
    sortOrder: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return channelId
}

async function getProjectAdministratorRecipients(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly organizationId: string
}): Promise<readonly {
  readonly userId: string
  readonly email: string
  readonly displayName: string
}[]> {
  const assignedRows = await input.db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(projectRoleAssignments)
    .innerJoin(users, eq(users.id, projectRoleAssignments.userId))
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(projectRoleAssignments.projectId, input.projectId),
        eq(projectRoleAssignments.roleId, PROJECT_ADMINISTRATOR_ROLE_ID),
        eq(projectRoleAssignments.isActive, true),
        eq(organizationMembers.organizationId, input.organizationId),
        eq(users.isActive, true)
      )
    )

  const rows =
    assignedRows.length > 0
      ? assignedRows
      : await input.db
          .select({
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
          })
          .from(users)
          .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
          .where(
            and(
              eq(organizationMembers.organizationId, input.organizationId),
              eq(users.role, "project_administrator"),
              eq(users.isActive, true)
            )
          )

  const recipients = new Map<
    string,
    { readonly userId: string; readonly email: string; readonly displayName: string }
  >()
  for (const row of rows) {
    recipients.set(row.userId, {
      userId: row.userId,
      email: row.email,
      displayName: row.displayName ?? row.email,
    })
  }

  return Array.from(recipients.values())
}

async function notifyProjectAdministratorOfBill(input: {
  readonly db: ReturnType<typeof getDb>
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly organizationId: string
  }
  readonly submissionId: string
  readonly submittedByUserId: string
  readonly submittedByName: string
  readonly vendorName: string
  readonly billNumber: string | null
  readonly totalAmount: number
}): Promise<void> {
  const recipients = await getProjectAdministratorRecipients({
    db: input.db,
    projectId: input.project.id,
    organizationId: input.project.organizationId,
  })

  const channelId = await ensureProjectStaffChannel({
    db: input.db,
    project: input.project,
    createdByUserId: input.submittedByUserId,
  })
  for (const recipient of recipients) {
    await ensureChannelMembership({
      db: input.db,
      channelId,
      userId: recipient.userId,
      role: "member",
    })
  }

  const now = new Date().toISOString()
  const messageId = crypto.randomUUID()
  const reviewHref = `/dashboard/projects/${input.project.id}/bill-submissions`
  const recipientMentions =
    recipients.length > 0
      ? recipients
          .map(
            (recipient) =>
              `<span class="mention" data-type="mention" data-id="${escapeHtml(
                recipient.userId
              )}" data-label="${escapeHtml(recipient.displayName)}">@${escapeHtml(
                recipient.displayName
              )}</span>`
          )
          .join(" ")
      : "<strong>Project administrator needed</strong>"
  const billLabel = input.billNumber
    ? `Invoice ${input.billNumber}`
    : "A vendor bill"
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(input.totalAmount)
  const contentHtml = [
    `<p>${recipientMentions}</p>`,
    `<p>${escapeHtml(billLabel)} from <strong>${escapeHtml(
      input.vendorName
    )}</strong> was submitted for ${escapeHtml(projectLabel(input.project))}.</p>`,
    `<p><strong>Amount:</strong> ${escapeHtml(amount)}<br /><strong>Submitted by:</strong> ${escapeHtml(
      input.submittedByName
    )}</p>`,
    `<p><a href="${escapeHtml(reviewHref)}">Review bill submission</a></p>`,
  ].join("")
  const content = `${billLabel} from ${input.vendorName} was submitted for ${projectLabel(
    input.project
  )}. Amount: ${amount}. Review: ${reviewHref}`

  await input.db.insert(messages).values({
    id: messageId,
    channelId,
    threadId: null,
    userId: input.submittedByUserId,
    content,
    contentHtml,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    isPinned: false,
    replyCount: 0,
    lastReplyAt: null,
    createdAt: now,
  })

  if (recipients.length > 0) {
    await input.db.insert(messageMentions).values(
      recipients.map((recipient) => ({
        id: crypto.randomUUID(),
        messageId,
        mentionType: "user",
        targetId: recipient.userId,
        createdAt: now,
      }))
    )

    await createNotificationEvent({
      organizationId: input.project.organizationId,
      projectId: input.project.id,
      eventType: "message.mention",
      sourceType: "vendor_bill_submission",
      sourceId: input.submissionId,
      title: `Bill submitted for ${projectLabel(input.project)}`,
      body: `${input.vendorName} submitted ${billLabel.toLowerCase()} for ${amount}.`,
      href: reviewHref,
      priority: "normal",
      audience: "project_administrator",
      createdBy: input.submittedByUserId,
      recipients,
    })
  }
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
        name: projects.name,
        projectNumber: projects.projectNumber,
        organizationId: projects.organizationId,
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
    if (!project.organizationId) {
      return NextResponse.json(
        { success: false, error: "Project is not linked to an organization." },
        { status: 400 }
      )
    }
    const scopedProject = {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
      organizationId: project.organizationId,
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
            const folderId = await findOrCreateUncodedBillFolder({
              client,
              googleEmail,
              projectFolderId,
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
      isChangeOrder: false,
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

    try {
      await notifyProjectAdministratorOfBill({
        db,
        project: scopedProject,
        submissionId,
        submittedByUserId: user.id,
        submittedByName: user.displayName ?? user.email,
        vendorName,
        billNumber,
        totalAmount,
      })
    } catch (notificationError) {
      console.error(
        "[vendor-bill-submissions] failed to notify project administrator",
        notificationError
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
