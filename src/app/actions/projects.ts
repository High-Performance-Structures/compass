"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  organizationMembers,
  projectExternalLinks,
  projectMembers,
  projectNumberReservations,
  projectOperations,
  projects,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { recordActivityEvent } from "@/lib/activity-log"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import {
  buildProjectDriveFolderName,
  provisionProjectDriveFolder as provisionGoogleProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"
import {
  allocateProjectNumber,
  buildProjectTrackerRow,
  findProjectTrackerSheetTitle,
  locateProjectTrackerLayout,
  type ProjectIntakeDepartment,
  type ProjectIntakeTrackerInput,
} from "@/lib/google/project-intake-tracker"
import { requireOrg } from "@/lib/org-scope"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

export type ProjectStatusValue =
  | "OPEN"
  | "WARRANTY"
  | "COMPLETE"
  | "INACTIVE"
  | "ARCHIVE"
  | "OTHER"

const PROJECT_STATUS_VALUES: readonly ProjectStatusValue[] = [
  "OPEN",
  "WARRANTY",
  "COMPLETE",
  "INACTIVE",
  "ARCHIVE",
  "OTHER",
]

export type ProjectListItem = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly googleDriveFolderId: string | null
  readonly status: string
  readonly createdAt: string
}

export type CreateProjectShellInput = {
  readonly projectNumber: string | null
  readonly name: string
  readonly department: "O" | "H" | "N" | "D" | "UNASSIGNED"
  readonly clientName: string | null
  readonly address: string | null
  readonly status: string
}

type CreateProjectShellResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type UpdateProjectStatusResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type ProjectIntakeAssignee = {
  readonly id: string
  readonly name: string
  readonly email: string
}

export type CreateProjectIntakeInput = Omit<
  ProjectIntakeTrackerInput,
  "intakeDate"
>

export type CreateProjectIntakeResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber: string
      readonly trackerStatus: "written" | "pending"
      readonly driveStatus: "provisioned" | "pending"
      readonly sageStatus: "staged"
      readonly warning: string | null
    }
  | { readonly success: false; readonly error: string }

const PROJECT_LEAD_TRACKING_SPREADSHEET_ID =
  "15DPCjDK9a4b3pkNB7ZdSFtJsSN1q2CyajNUBb40aRkE"

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} is required`)
  return trimmed
}

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function departmentPrefix(
  department: CreateProjectShellInput["department"]
): string {
  if (department === "O") return "o"
  if (department === "H") return "h"
  if (department === "N") return "n"
  if (department === "D") return "d"
  return "unassigned"
}

function projectSequence(projectNumber: string): number {
  const match = /^[A-Z]-(\d+)-/i.exec(projectNumber)
  if (!match) throw new Error("Compass could not reserve the project sequence.")
  const sequence = Number(match[1])
  if (!Number.isInteger(sequence)) {
    throw new Error("Compass could not reserve the project sequence.")
  }
  return sequence
}

function isProjectSequenceConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("project_number_reservations") ||
      error.message.toLowerCase().includes("unique constraint"))
  )
}

function normalizedIntakeDepartment(
  value: unknown
): ProjectIntakeDepartment | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (
    normalized === "O" ||
    normalized === "H" ||
    normalized === "N" ||
    normalized === "D"
  ) {
    return normalized
  }
  return null
}

function isProjectStatusValue(value: string): value is ProjectStatusValue {
  return PROJECT_STATUS_VALUES.some((status) => status === value)
}

function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${range}`
}

function joinedAddress(input: CreateProjectIntakeInput): string | null {
  const street = [cleanText(input.streetNumber), cleanText(input.streetName)]
    .filter((value) => value !== null)
    .join(" ")
  return [street || null, cleanText(input.cityStateZip)]
    .filter((value) => value !== null)
    .join(", ") || null
}

function intakeClientName(input: CreateProjectIntakeInput): string | null {
  const explicit = cleanText(input.clientName)
  if (explicit) return explicit
  const contact = [cleanText(input.clientFirstName), cleanText(input.clientLastName)]
    .filter((value) => value !== null)
    .join(" ")
  return contact || cleanText(input.companyName)
}

type ProjectWorkspaceClients = {
  readonly sheets: SheetsClient
  readonly drive: DriveClient
}

async function projectWorkspaceClients(input: {
  readonly environment: CloudflareEnv
  readonly organizationId: string
}): Promise<ProjectWorkspaceClients> {
  const db = getDb(input.environment.DB)
  const authRows = await db
    .select()
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, input.organizationId))
    .limit(1)
  const auth = authRows[0]
  if (!auth) throw new Error("Google Workspace service account is not connected.")

  const config = getGoogleConfig(input.environment)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  const serviceAccountKey = parseServiceAccountKey(keyJson)
  return {
    sheets: new SheetsClient(serviceAccountKey),
    drive: new DriveClient({ serviceAccountKey }),
  }
}

function appendWarning(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next
}

function projectDepartment(projectNumber: string | null): ProjectIntakeDepartment | null {
  return normalizedIntakeDepartment(projectNumber?.slice(0, 1) ?? null)
}

function metadataFolderName(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "folderName" in parsed &&
      typeof parsed.folderName === "string"
    ) {
      return cleanText(parsed.folderName)
    }
  } catch {
    return null
  }
  return null
}

export async function getProjectIntakeAssignees(): Promise<
  readonly ProjectIntakeAssignee[]
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const db = getDb(env.DB)
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
      name:
        cleanText(row.displayName) ??
        ([cleanText(row.firstName), cleanText(row.lastName)]
          .filter((value) => value !== null)
          .join(" ") || row.email),
      email: row.email,
    }))
  } catch {
    return []
  }
}

export async function createProjectIntake(
  input: CreateProjectIntakeInput
): Promise<CreateProjectIntakeResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }
    const db = getDb(env.DB)

    const projectName = requireText(input.projectName, "Project name")
    const department = normalizedIntakeDepartment(input.department)
    if (!department) {
      return { success: false, error: "Choose ORC, HPS, Nu-Tech, or Design." }
    }
    const intakeDate = new Date().toISOString().slice(0, 10)
    const googleClients = await projectWorkspaceClients({
      environment: env,
      organizationId,
    })
    const googleEmail = user.googleEmail ?? user.email
    const metadata = await googleClients.sheets.getSpreadsheetMetadata(
      googleEmail,
      PROJECT_LEAD_TRACKING_SPREADSHEET_ID
    )
    const trackerSheet = findProjectTrackerSheetTitle(
      metadata.sheets.map((sheet) => sheet.title)
    )
    if (!trackerSheet) {
      return {
        success: false,
        error:
          "Project Lead Tracking is missing its Master List sheet. No project was created.",
      }
    }
    const trackerRows = await googleClients.sheets.getValues(googleEmail, {
      spreadsheetId: PROJECT_LEAD_TRACKING_SPREADSHEET_ID,
      range: quotedSheetRange(trackerSheet, "A:AZ"),
    })
    const layout = locateProjectTrackerLayout(trackerRows)
    if (!layout) {
      return {
        success: false,
        error: "The Project Lead Tracking header row could not be identified.",
      }
    }
    const reservations = await db
      .select({ projectNumber: projectNumberReservations.projectNumber })
      .from(projectNumberReservations)
      .where(
        and(
          eq(projectNumberReservations.organizationId, organizationId),
          eq(projectNumberReservations.department, department)
        )
      )
    const compassProjectNumbers = await db
      .select({ projectNumber: projects.projectNumber })
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
    const projectNumber = allocateProjectNumber({
      department,
      streetNumber: input.streetNumber,
      rows: trackerRows,
      layout,
      reservedProjectNumbers: reservations.map(
        (reservation) => reservation.projectNumber
      ).concat(
        compassProjectNumbers.flatMap((project) =>
          project.projectNumber ? [project.projectNumber] : []
        )
      ),
    })
    const sequence = projectSequence(projectNumber)
    const duplicate = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.projectNumber, projectNumber)
        )
      )
      .limit(1)
    if (duplicate[0]) {
      return {
        success: false,
        error: `Compass project ${projectNumber} already exists. Refresh and try again.`,
      }
    }

    const now = new Date().toISOString()
    const projectId = `proj-${slugPart(projectNumber)}-${crypto.randomUUID().slice(0, 8)}`
    const operationId = crypto.randomUUID()
    const trackerLinkId = crypto.randomUUID()
    const driveLinkId = crypto.randomUUID()
    const sageLinkId = crypto.randomUUID()
    const sageOperationId = crypto.randomUUID()
    const trackerProject: ProjectIntakeTrackerInput = {
      ...input,
      department,
      projectName,
      intakeDate,
    }
    const trackerRow = buildProjectTrackerRow({
      layout,
      project: trackerProject,
      projectNumber,
    })
    const driveFolderName = buildProjectDriveFolderName({
      projectNumber,
      projectName,
      streetNumber: input.streetNumber,
      streetName: input.streetName,
    })
    const sagePayload = JSON.stringify({
      source: "compass_project_intake",
      projectId,
      projectNumber,
      department,
      projectName,
      clientName: intakeClientName(input),
      address: joinedAddress(input),
      assignedTo: cleanText(input.assignedTo),
    })

    try {
      await db.batch([
        db.insert(projects).values({
          id: projectId,
          organizationId,
          projectNumber,
          name: projectName,
          status: "OPEN",
          address: joinedAddress(input),
          clientName: intakeClientName(input),
          projectManager: cleanText(input.assignedTo),
          ownerUpdatesEnabled: true,
          ownerUpdateChannel: "compass",
          ownerUpdateCadence: "weekly",
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectNumberReservations).values({
          id: crypto.randomUUID(),
          organizationId,
          projectId,
          department,
          sequence,
          projectNumber,
          createdAt: now,
        }),
        db.insert(projectExternalLinks).values({
          id: crypto.randomUUID(),
          projectId,
          system: "compass",
          label: "Compass project",
          externalId: projectId,
          externalNumber: projectNumber,
          externalUrl: `/dashboard/projects/${projectId}`,
          syncDirection: "bidirectional",
          syncStatus: "mapped",
          metadata: JSON.stringify({ department }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectExternalLinks).values({
          id: driveLinkId,
          projectId,
          system: "google_drive",
          label: "Project Drive folder",
          externalId: null,
          externalNumber: null,
          externalUrl: null,
          syncDirection: "read_write",
          syncStatus: "pending",
          metadata: JSON.stringify({
            department,
            folderName: driveFolderName,
          }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectExternalLinks).values({
          id: sageLinkId,
          projectId,
          system: "sage",
          label: "Sage job",
          externalId: null,
          externalNumber: projectNumber,
          externalUrl: null,
          syncDirection: "bidirectional",
          syncStatus: "unmapped",
          metadata: JSON.stringify({
            pendingProjectNumber: projectNumber,
            source: "compass_project_intake",
          }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectExternalLinks).values({
          id: trackerLinkId,
          projectId,
          system: "google_project_lead_tracking",
          label: "Project Lead Tracking",
          externalId: PROJECT_LEAD_TRACKING_SPREADSHEET_ID,
          externalNumber: projectNumber,
          externalUrl: `https://docs.google.com/spreadsheets/d/${PROJECT_LEAD_TRACKING_SPREADSHEET_ID}`,
          syncDirection: "bidirectional",
          syncStatus: "pending",
          // Retain the exact row only while the handoff is pending so a later
          // reconciliation does not need to reconstruct discarded form fields.
          metadata: JSON.stringify({
            sheet: trackerSheet,
            headers: layout.headers,
            row: trackerRow,
          }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectOperations).values({
          id: operationId,
          projectId,
          sourceSystem: "google_project_lead_tracking",
          sourceRecordType: "project_intake",
          sourceRecordId: PROJECT_LEAD_TRACKING_SPREADSHEET_ID,
          sourceRecordNumber: projectNumber,
          title: `Write ${projectNumber} to Project Lead Tracking`,
          description:
            "Compass project intake and its Project Lead Tracking handoff.",
          status: "open",
          priority: "high",
          assigneeName: cleanText(input.assignedTo),
          companyName: cleanText(input.companyName),
          externalUrl: `https://docs.google.com/spreadsheets/d/${PROJECT_LEAD_TRACKING_SPREADSHEET_ID}`,
          sageWriteStatus: "not_ready",
          syncDirection: "bidirectional",
          syncStatus: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectOperations).values({
          id: sageOperationId,
          projectId,
          sourceSystem: "compass_project_intake",
          sourceRecordType: "sage_project_handoff",
          sourceRecordId: projectNumber,
          sourceRecordNumber: projectNumber,
          title: `${projectNumber} Sage project handoff`,
          description:
            "Review this Compass project intake, then create or match the Sage job.",
          status: "needs_review",
          priority: "high",
          assigneeType: "internal",
          assigneeName: cleanText(input.assignedTo),
          companyName: intakeClientName(input),
          externalUrl: null,
          sageWriteStatus: "needs_review",
          sagePayloadJson: sagePayload,
          syncDirection: "write",
          syncStatus: "pending_sage",
          createdAt: now,
          updatedAt: now,
        }),
      ])
    } catch (error) {
      if (isProjectSequenceConflict(error)) {
        return {
          success: false,
          error:
            "Another intake claimed that department number. Your entries are still here; submit again to receive the next number.",
        }
      }
      throw error
    }

    let trackerStatus: "written" | "pending" = "written"
    let warning: string | null = null
    try {
      const appended = await googleClients.sheets.appendValues(googleEmail, {
        spreadsheetId: PROJECT_LEAD_TRACKING_SPREADSHEET_ID,
        range: quotedSheetRange(
          trackerSheet,
          `A${layout.headerRowNumber}:AZ`
        ),
        values: [trackerRow],
      })
      const syncedAt = new Date().toISOString()
      try {
        await db.batch([
          db
            .update(projectExternalLinks)
            .set({
              syncStatus: "mapped",
              lastSyncedAt: syncedAt,
              metadata: JSON.stringify({
                sheet: trackerSheet,
                updatedRange: appended.updatedRange,
              }),
              updatedAt: syncedAt,
            })
            .where(eq(projectExternalLinks.id, trackerLinkId)),
          db
            .update(projectOperations)
            .set({
              status: "completed",
              syncStatus: "mapped",
              lastSyncedAt: syncedAt,
              updatedAt: syncedAt,
            })
            .where(eq(projectOperations.id, operationId)),
        ])
      } catch (error) {
        // The Google write already succeeded. Preserve that truth so a retry
        // can reconcile by project number instead of appending a duplicate row.
        warning = appendWarning(
          warning,
          "Project Lead Tracking was updated, but Compass could not save its sync receipt. The project is safe to use; do not resend the intake."
        )
        console.error("Unable to save the Project Lead Tracking receipt", error)
      }
    } catch (error) {
      trackerStatus = "pending"
      warning = appendWarning(
        warning,
        "The Compass project and number were saved, but Project Lead Tracking is pending and recorded for follow-up. Do not recreate the project."
      )
      console.error("Unable to append the new project to Project Lead Tracking", error)
    }

    let driveStatus: "provisioned" | "pending" = "provisioned"
    try {
      const drive = await provisionGoogleProjectDriveFolder(
        googleClients.drive,
        googleEmail,
        { department, folderName: driveFolderName }
      )
      const syncedAt = new Date().toISOString()
      try {
        await db.batch([
          db
            .update(projects)
            .set({
              googleDriveFolderId: drive.folderId,
              updatedAt: syncedAt,
            })
            .where(eq(projects.id, projectId)),
          db
            .update(projectExternalLinks)
            .set({
              externalId: drive.folderId,
              externalUrl: drive.folderUrl,
              syncStatus: "mapped",
              lastSyncedAt: syncedAt,
              metadata: JSON.stringify({
                department,
                folderName: drive.folderName,
                parentFolderId: drive.parentFolderId,
                childFolderNames: drive.childFolderNames,
              }),
              updatedAt: syncedAt,
            })
            .where(eq(projectExternalLinks.id, driveLinkId)),
          db
            .update(projectOperations)
            .set({ externalUrl: drive.folderUrl, updatedAt: syncedAt })
            .where(eq(projectOperations.id, sageOperationId)),
        ])
      } catch (error) {
        driveStatus = "pending"
        warning = appendWarning(
          warning,
          "The Drive folder was created, but Compass could not save its link. Use Retry Drive setup in the Project Registry; it will reuse the folder."
        )
        console.error("Unable to save the project Drive receipt", error)
      }
    } catch (error) {
      driveStatus = "pending"
      warning = appendWarning(
        warning,
        "Google Drive setup is pending. The Compass project is safe to use; retry Drive setup from the Project Registry."
      )
      console.error("Unable to provision the project Drive folder", error)
    }

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "account",
      action: "project.created",
      entityType: "project",
      entityId: projectId,
      summary: `Created ${projectNumber} — ${projectName}.`,
      metadata: { department, trackerStatus, driveStatus, sageStatus: "staged" },
    })
    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard")
    return {
      success: true,
      id: projectId,
      projectNumber,
      trackerStatus,
      driveStatus,
      sageStatus: "staged",
      warning,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    }
  }
}

export type ProvisionProjectDriveResult =
  | {
      readonly success: true
      readonly folderId: string
      readonly folderUrl: string
      readonly createdRoot: boolean
      readonly createdChildCount: number
    }
  | { readonly success: false; readonly error: string }

export async function provisionProjectDriveFolder(
  projectId: string
): Promise<ProvisionProjectDriveResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    requirePermission(user, "document", "create")
    if (!canManageProjectRegistry(user)) {
      return {
        success: false,
        error: "Permission denied: project registry is admin-only",
      }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }
    const db = getDb(env.DB)
    const [project] = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!project) return { success: false, error: "Project not found" }
    if (project.googleDriveFolderId) {
      return {
        success: true,
        folderId: project.googleDriveFolderId,
        folderUrl: `https://drive.google.com/drive/folders/${project.googleDriveFolderId}`,
        createdRoot: false,
        createdChildCount: 0,
      }
    }

    const department = projectDepartment(project.projectNumber)
    if (!department || !project.projectNumber) {
      return {
        success: false,
        error: "Set an O, H, N, or D project number before provisioning Drive.",
      }
    }
    const [driveLink] = await db
      .select({
        id: projectExternalLinks.id,
        metadata: projectExternalLinks.metadata,
      })
      .from(projectExternalLinks)
      .where(
        and(
          eq(projectExternalLinks.projectId, projectId),
          eq(projectExternalLinks.system, "google_drive")
        )
      )
      .limit(1)
    const folderName =
      metadataFolderName(driveLink?.metadata ?? null) ??
      buildProjectDriveFolderName({
        projectNumber: project.projectNumber,
        projectName: project.name,
        streetNumber: null,
        streetName: null,
      })
    const googleClients = await projectWorkspaceClients({
      environment: env,
      organizationId,
    })
    const drive = await provisionGoogleProjectDriveFolder(
      googleClients.drive,
      user.googleEmail ?? user.email,
      { department, folderName }
    )
    const now = new Date().toISOString()
    const linkValues = {
      label: "Project Drive folder",
      externalId: drive.folderId,
      externalNumber: null,
      externalUrl: drive.folderUrl,
      syncDirection: "read_write",
      syncStatus: "mapped",
      lastSyncedAt: now,
      metadata: JSON.stringify({
        department,
        folderName: drive.folderName,
        parentFolderId: drive.parentFolderId,
        childFolderNames: drive.childFolderNames,
      }),
      updatedAt: now,
    }
    const projectUpdate = db
      .update(projects)
      .set({ googleDriveFolderId: drive.folderId, updatedAt: now })
      .where(eq(projects.id, projectId))
    const sageOperationUpdate = db
      .update(projectOperations)
      .set({ externalUrl: drive.folderUrl, updatedAt: now })
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "sage_project_handoff")
        )
      )
    if (driveLink) {
      await db.batch([
        projectUpdate,
        sageOperationUpdate,
        db
          .update(projectExternalLinks)
          .set(linkValues)
          .where(eq(projectExternalLinks.id, driveLink.id)),
      ])
    } else {
      await db.batch([
        projectUpdate,
        sageOperationUpdate,
        db.insert(projectExternalLinks).values({
          id: crypto.randomUUID(),
          projectId,
          system: "google_drive",
          createdAt: now,
          ...linkValues,
        }),
      ])
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "file",
      action: "project.drive_provisioned",
      entityType: "project",
      entityId: projectId,
      summary: `Provisioned the Drive folder for ${project.projectNumber}.`,
      metadata: {
        folderId: drive.folderId,
        createdRoot: drive.createdRoot,
        createdChildCount: drive.createdChildCount,
      },
    })
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard/projects")
    revalidatePath("/dashboard/files")
    return {
      success: true,
      folderId: drive.folderId,
      folderUrl: drive.folderUrl,
      createdRoot: drive.createdRoot,
      createdChildCount: drive.createdChildCount,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to provision Drive",
    }
  }
}

export async function getProjects(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)

    if (
      user.organizationId &&
      user.organizationType === "internal" &&
      canUseOrganizationProjectScopeRole(user.role)
    ) {
      return await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
          clientName: projects.clientName,
          googleDriveFolderId: projects.googleDriveFolderId,
          status: projects.status,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .where(eq(projects.organizationId, user.organizationId))
        .orderBy(asc(projects.projectNumber), asc(projects.name))
    }

    return await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        googleDriveFolderId: projects.googleDriveFolderId,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, user.id))
      .orderBy(asc(projects.projectNumber), asc(projects.name))
  } catch {
    return []
  }
}

export async function createProjectShell(
  input: CreateProjectShellInput
): Promise<CreateProjectShellResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }

    const db = getDb(env.DB)
    const projectNumber = cleanText(input.projectNumber)
    const name = requireText(input.name, "Project name")
    const status = cleanText(input.status) ?? "OPEN"

    if (projectNumber) {
      const duplicate = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, orgId),
            eq(projects.projectNumber, projectNumber)
          )
        )
        .limit(1)

      if (duplicate[0]) {
        return {
          success: false,
          error: "A project with that Compass number already exists.",
        }
      }
    }

    const now = new Date().toISOString()
    const idBase = projectNumber
      ? slugPart(projectNumber)
      : `${departmentPrefix(input.department)}-${slugPart(name)}`
    const id = `proj-${idBase}-${crypto.randomUUID().slice(0, 8)}`

    await db.insert(projects).values({
      id,
      organizationId: orgId,
      projectNumber,
      name,
      status,
      address: cleanText(input.address),
      clientName: cleanText(input.clientName),
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(projectExternalLinks).values({
      id: crypto.randomUUID(),
      projectId: id,
      system: "compass",
      label: "Compass project shell",
      externalId: id,
      externalNumber: projectNumber,
      externalUrl: `/dashboard/projects/${id}`,
      syncDirection: "bidirectional",
      syncStatus: "mapped",
      metadata: JSON.stringify({ department: input.department }),
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${id}`)
    revalidatePath("/dashboard")
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    }
  }
}

export async function updateProjectStatus(
  projectId: string,
  status: string
): Promise<UpdateProjectStatusResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }

    if (!isProjectStatusValue(status)) {
      return { success: false, error: "Unsupported project status." }
    }

    const db = getDb(env.DB)
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId))
      )
      .limit(1)

    if (!existing[0]) {
      return { success: false, error: "Project not found" }
    }

    await db
      .update(projects)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, projectId))

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update project status",
    }
  }
}
