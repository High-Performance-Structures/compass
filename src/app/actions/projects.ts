"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  customers,
  organizationMembers,
  projectContacts,
  projectExternalLinks,
  projectJobStatuses,
  projectMembers,
  projectNumberReservations,
  projectOperations,
  projects,
  users,
} from "@/db/schema"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { googleAuth } from "@/db/schema-google"
import { and, asc, eq, or, sql } from "drizzle-orm"
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
  projectDriveTemplateFolderId,
  provisionProjectDriveFolder as provisionGoogleProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"
import {
  allocateProjectNumber,
  buildDepartmentTrackerRow,
  buildProjectRegistryRow,
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  PROJECT_REGISTRY_DESTINATION,
  projectRowNumber,
  type ProjectIntakeDepartment,
  type ProjectIntakeTrackerInput,
  type ProjectTrackerLayout,
} from "@/lib/google/project-intake-tracker"
import { resolveProjectIntakeIntegrationEmail } from "@/lib/google/project-intake-identity"
import { requireOrg } from "@/lib/org-scope"
import {
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
} from "@/lib/contact-identity-ownership"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"
import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  projectJobStatusLabel,
} from "@/lib/project-profile"
import {
  isSageWriteApproved,
  parseSageClientStatusId,
  parseSageJobTypeId,
  sageClientStatusName,
  sageJobName,
  sageJobTypeName,
  sageShortName,
  type SageClientStatusId,
  type SageJobTypeId,
} from "@/lib/sage/client-project-write"

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
  readonly clientStatus: string
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly createdAt: string
}

type ProjectListRow = Omit<ProjectListItem, "jobStatusLabel"> & {
  readonly customJobStatusLabel: string | null
}

function projectListItems(rows: readonly ProjectListRow[]): ProjectListItem[] {
  return rows.map(({ customJobStatusLabel, ...project }) => ({
    ...project,
    jobStatusLabel: projectJobStatusLabel({
      jobStatusId: project.jobStatusId,
      customLabel: customJobStatusLabel,
    }),
  }))
}

export type CreateProjectShellInput = {
  readonly projectNumber: string | null
  readonly name: string
  readonly department: "O" | "H" | "N" | "D" | "UNASSIGNED"
  readonly clientName: string | null
  readonly address: string | null
  readonly status: string
  readonly sageClientStatusId: SageClientStatusId
  readonly sageJobStatusId: string
  readonly sageJobType: SageJobTypeId
}

type CreateProjectShellResult =
  | {
      readonly success: true
      readonly id: string
      readonly sageStatus: "queued" | "approval_required"
    }
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
> & {
  readonly sageClientStatusId: SageClientStatusId
  readonly sageJobStatusId: string
  readonly sageJobType: SageJobTypeId
}

export type CreateProjectIntakeResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber: string
      readonly trackerStatus: "written" | "pending"
      readonly driveStatus: "provisioned" | "pending"
      readonly sageStatus: "queued" | "approval_required"
      readonly warning: string | null
    }
  | { readonly success: false; readonly error: string }

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

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

async function appendProjectRowIfMissing(input: {
  readonly sheets: SheetsClient
  readonly googleEmail: string
  readonly spreadsheetId: string
  readonly sheetTitle: string
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>
  readonly layout: ProjectTrackerLayout
  readonly projectNumber: string
  readonly row: readonly string[]
}): Promise<{ readonly updatedRange: string; readonly alreadyPresent: boolean }> {
  const existingRow = projectRowNumber(
    input.rows,
    input.layout,
    input.projectNumber
  )
  if (existingRow !== null) {
    return {
      updatedRange: quotedSheetRange(
        input.sheetTitle,
        `A${existingRow}:${String.fromCharCode(64 + Math.min(input.layout.headers.length, 26))}${existingRow}`
      ),
      alreadyPresent: true,
    }
  }
  const appended = await input.sheets.appendValues(input.googleEmail, {
    spreadsheetId: input.spreadsheetId,
    range: quotedSheetRange(
      input.sheetTitle,
      `A${input.layout.headerRowNumber}:AZ`
    ),
    values: [input.row],
  })
  return {
    updatedRange:
      appended.updatedRange ?? quotedSheetRange(input.sheetTitle, "A:AZ"),
    alreadyPresent: false,
  }
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
  readonly projectIntakeGoogleEmail: string
}

async function projectWorkspaceClients(input: {
  readonly environment: CloudflareEnv
  readonly organizationId: string
}): Promise<ProjectWorkspaceClients> {
  const db = getDb(input.environment.DB)
  const authRows = await db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
      connectorGoogleEmail: users.googleEmail,
      connectorEmail: users.email,
    })
    .from(googleAuth)
    .innerJoin(users, eq(users.id, googleAuth.connectedBy))
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
    projectIntakeGoogleEmail: resolveProjectIntakeIntegrationEmail({
      connectorGoogleEmail: auth.connectorGoogleEmail,
      connectorEmail: auth.connectorEmail,
    }),
  }
}

function appendWarning(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next
}

function intakeAssigneeName(input: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  return (
    cleanText(input.displayName) ??
    ([cleanText(input.firstName), cleanText(input.lastName)]
      .filter((value) => value !== null)
      .join(" ") || input.email)
  )
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
      name: intakeAssigneeName(row),
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
    const clientName = requireText(intakeClientName(input) ?? "", "Client")
    const sageClientStatusId = parseSageClientStatusId(input.sageClientStatusId)
    if (!sageClientStatusId) {
      return { success: false, error: "Choose a Sage client status." }
    }
    const sageJobStatus = PROJECT_JOB_STATUS_DEFINITIONS.find(
      (status) => status.id === input.sageJobStatusId
    )
    if (!sageJobStatus) {
      return { success: false, error: "Choose a Sage job status." }
    }
    const sageJobType = parseSageJobTypeId(input.sageJobType)
    if (!sageJobType) {
      return { success: false, error: "Choose a Sage job type." }
    }
    const sageWriteApproved = await isSageWriteApproved(
      db,
      organizationId,
      user.id
    )
    const department = normalizedIntakeDepartment(input.department)
    if (!department) {
      return { success: false, error: "Choose ORC, HPS, Nu-Tech, or Design." }
    }
    const intakeDate = new Date().toISOString().slice(0, 10)
    const googleClients = await projectWorkspaceClients({
      environment: env,
      organizationId,
    })
    const submittingGoogleEmail = user.googleEmail ?? user.email
    const projectIntakeGoogleEmail = googleClients.projectIntakeGoogleEmail
    const departmentDestination = departmentTrackingDestination(department)
    const [registryRows, departmentRows] = await Promise.all([
      googleClients.sheets.getValues(projectIntakeGoogleEmail, {
        spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
        range: quotedSheetRange(PROJECT_REGISTRY_DESTINATION.sheetTitle, "A:Z"),
      }),
      googleClients.sheets.getValues(projectIntakeGoogleEmail, {
        spreadsheetId: departmentDestination.spreadsheetId,
        range: quotedSheetRange(departmentDestination.sheetTitle, "A:AZ"),
      }),
    ])
    const registryLayout = locateProjectTrackerLayout(registryRows)
    const departmentLayout = locateProjectTrackerLayout(departmentRows)
    if (!registryLayout || !departmentLayout) {
      return {
        success: false,
        error:
          "The Developer Project Registry or department Tracker headers could not be identified. No project was created.",
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
      rows: registryRows,
      layout: registryLayout,
      reservedProjectNumbers: reservations.map(
        (reservation) => reservation.projectNumber
      ).concat(
        departmentRows.slice(departmentLayout.headerRowNumber).flatMap((row) => {
          const value = row[departmentLayout.projectNumberColumn]
          return typeof value === "string" && value.trim() ? [value] : []
        }),
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

    const customerEmail = cleanText(input.contactEmail)?.toLowerCase() ?? null
    const customerMatch = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          customerEmail
            ? or(
                sql`lower(trim(${customers.email})) = ${customerEmail}`,
                sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
              )
            : sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
        )
      )
      .limit(1)
      .get()
    const customerId = customerMatch?.id ?? crypto.randomUUID()

    const assignedTo = cleanText(input.assignedTo)
    const assigneeRows = assignedTo
      ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            address: users.address,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(users.isActive, true)
            )
          )
      : []
    const assignee = assignedTo
      ? assigneeRows.find(
          (candidate) =>
            intakeAssigneeName(candidate).toLowerCase() === assignedTo.toLowerCase()
        ) ?? null
      : null
    const projectManagerName = assignee
      ? intakeAssigneeName(assignee)
      : assignedTo

    const now = new Date().toISOString()
    const projectId = `proj-${slugPart(projectNumber)}-${crypto.randomUUID().slice(0, 8)}`
    const ownerContactId = crypto.randomUUID()
    const internalContactId = assignedTo ? crypto.randomUUID() : null
    const operationId = crypto.randomUUID()
    const registryLinkId = crypto.randomUUID()
    const departmentTrackerLinkId = crypto.randomUUID()
    const driveLinkId = crypto.randomUUID()
    const sageLinkId = crypto.randomUUID()
    const sageOperationId = crypto.randomUUID()
    const sageWriteOperationId = crypto.randomUUID()
    const trackerProject: ProjectIntakeTrackerInput = {
      ...input,
      department,
      projectName,
      intakeDate,
    }
    const driveFolderName = buildProjectDriveFolderName({
      projectNumber,
      projectName,
      streetNumber: input.streetNumber,
      streetName: input.streetName,
    })
    const customerValues = {
      id: customerId,
      organizationId,
      name: clientName,
      company: cleanText(input.companyName) ?? customerMatch?.company ?? null,
      email: cleanText(input.contactEmail) ?? customerMatch?.email ?? null,
      phone: cleanText(input.contactPhone) ?? customerMatch?.phone ?? null,
      address:
        cleanText(input.billingAddress) ??
        customerMatch?.address ??
        joinedAddress(input) ??
        null,
      notes: cleanText(input.notes) ?? customerMatch?.notes ?? null,
      sageClientStatusId,
      createdAt: now,
      updatedAt: now,
    }
    if (
      customerMatch &&
      contactIdentityChanged(customerMatch, customerValues) &&
      (await directoryIdentityManagedByActiveUser({
        db,
        organizationId,
        entityType: "customer",
        entityId: customerId,
      }))
    ) {
      return {
        success: false,
        error:
          "This active Compass client manages their own phone, email, and address. Use their existing directory details for this project.",
      }
    }
    const fullSageJobName = sageJobName(projectNumber, projectName)
    const sageWritePayload = {
      operationType: "ensure_client_and_job" as const,
      company: "High Performance Structures Inc" as const,
      client: {
        compassCustomerId: customerId,
        name: clientName,
        shortName: sageShortName(cleanText(input.companyName) ?? clientName),
        company: cleanText(input.companyName),
        email: cleanText(input.contactEmail),
        phone: cleanText(input.contactPhone),
        address: joinedAddress(input),
        billingAddress: cleanText(input.billingAddress),
        notes: cleanText(input.notes),
        status: {
          expectedNumber: sageClientStatusId,
          name: sageClientStatusName(sageClientStatusId),
        },
      },
      job: {
        compassProjectId: projectId,
        compassProjectNumber: projectNumber,
        name: fullSageJobName,
        shortName: sageShortName(fullSageJobName),
        address: joinedAddress(input),
        statusName: sageJobStatus.label,
        typeName: sageJobTypeName(sageJobType),
      },
    }

    try {
      await db.batch([
        db.insert(projects).values({
          id: projectId,
          organizationId,
          projectNumber,
          department,
          name: projectName,
          status: "OPEN",
          address: joinedAddress(input),
          clientName: intakeClientName(input),
          clientStatus: "customer",
          jobStatusId: sageJobStatus.id,
          sageJobStatusName: sageJobStatus.label,
          sageJobTypeName: sageJobTypeName(sageJobType),
          projectManager: projectManagerName,
          ownerUpdatesEnabled: true,
          ownerUpdateChannel: "compass",
          ownerUpdateCadence: "weekly",
          createdAt: now,
          updatedAt: now,
        }),
        customerMatch
          ? db
              .update(customers)
              .set({
                company: customerValues.company ?? customerMatch.company,
                email: customerValues.email ?? customerMatch.email,
                phone: customerValues.phone ?? customerMatch.phone,
                address: customerValues.address ?? customerMatch.address,
                notes: customerValues.notes ?? customerMatch.notes,
                sageClientStatusId,
                updatedAt: now,
              })
              .where(eq(customers.id, customerId))
          : db.insert(customers).values(customerValues),
        db.insert(projectContacts).values({
          id: ownerContactId,
          projectId,
          contactType: "owner",
          sourceSystem: "customer_directory",
          sourceRecordId: customerId,
          sourceEntityType: "customer",
          sourceEntityId: customerId,
          displayName: clientName,
          companyName: customerValues.company,
          role: "Owner / Client",
          email: customerValues.email,
          phone: customerValues.phone,
          address: customerValues.address,
          notes: null,
          ownerPortalVisible: true,
          subVendorPortalVisible: false,
          internalVisible: true,
          primaryContact: true,
          active: true,
          sortOrder: 100,
          syncStatus: "manual",
          lastSyncedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
        ...(assignedTo && internalContactId
          ? [
              db.insert(projectContacts).values({
                id: internalContactId,
                projectId,
                contactType: "internal",
                sourceSystem: assignee
                  ? "organization_directory"
                  : "compass_project_intake",
                sourceRecordId: assignee?.id ?? projectId,
                sourceEntityType: assignee ? "user" : "manual",
                sourceEntityId: assignee?.id ?? null,
                displayName: projectManagerName ?? assignedTo,
                companyName: null,
                role: "Project manager",
                email: assignee?.email ?? null,
                phone: assignee?.phone ?? null,
                address: assignee?.address ?? null,
                notes: assignee
                  ? null
                  : "Typed project intake assignment; match this contact to an active team member when available.",
                ownerPortalVisible: true,
                subVendorPortalVisible: true,
                internalVisible: true,
                primaryContact: true,
                active: true,
                sortOrder: 200,
                syncStatus: assignee ? "synced" : "manual",
                lastSyncedAt: assignee ? now : null,
                createdAt: now,
                updatedAt: now,
              }),
            ]
          : []),
        ...(assignee
          ? [
              db.insert(projectMembers).values({
                id: crypto.randomUUID(),
                projectId,
                userId: assignee.id,
                role: "project-manager",
                assignedAt: now,
              }),
            ]
          : []),
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
          id: registryLinkId,
          projectId,
          system: "google_project_registry",
          label: PROJECT_REGISTRY_DESTINATION.workbookTitle,
          externalId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
          externalNumber: projectNumber,
          externalUrl: spreadsheetUrl(
            PROJECT_REGISTRY_DESTINATION.spreadsheetId
          ),
          syncDirection: "bidirectional",
          syncStatus: "pending",
          metadata: JSON.stringify({
            sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
            projectNumber,
          }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectExternalLinks).values({
          id: departmentTrackerLinkId,
          projectId,
          system: "google_department_tracker",
          label: departmentDestination.workbookTitle,
          externalId: departmentDestination.spreadsheetId,
          externalNumber: projectNumber,
          externalUrl: spreadsheetUrl(departmentDestination.spreadsheetId),
          syncDirection: "bidirectional",
          syncStatus: "pending",
          metadata: JSON.stringify({
            sheet: departmentDestination.sheetTitle,
            department,
            projectNumber,
          }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(projectOperations).values({
          id: operationId,
          projectId,
          sourceSystem: "google_developer_project_tracking",
          sourceRecordType: "project_intake",
          sourceRecordId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
          sourceRecordNumber: projectNumber,
          title: `Write ${projectNumber} to Developer project trackers`,
          description:
            `Write Compass intake to Project Registry and ${departmentDestination.workbookTitle}.`,
          status: "open",
          priority: "high",
          assigneeName: cleanText(input.assignedTo),
          companyName: cleanText(input.companyName),
          externalUrl: spreadsheetUrl(
            PROJECT_REGISTRY_DESTINATION.spreadsheetId
          ),
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
          title: `${projectNumber} Sage client/job write`,
          description: sageWriteApproved
            ? "Approved Compass intake queued for the narrow Sage client/job writer."
            : "Compass intake recorded; Sage write is blocked until requested by an approved user.",
          status: sageWriteApproved ? "open" : "needs_review",
          priority: "high",
          assigneeType: "internal",
          assigneeName: cleanText(input.assignedTo),
          companyName: intakeClientName(input),
          externalUrl: null,
          sageWriteStatus: sageWriteApproved ? "queued" : "approval_required",
          sagePayloadJson: JSON.stringify(sageWritePayload),
          syncDirection: "write",
          syncStatus: "pending_sage",
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(sageClientProjectWriteOperations).values({
          id: sageWriteOperationId,
          organizationId,
          customerId,
          projectId,
          requestedByUserId: user.id,
          operationType: "ensure_client_and_job",
          idempotencyKey: `project:${projectId}`,
          payloadJson: JSON.stringify(sageWritePayload),
          status: sageWriteApproved ? "queued" : "approval_required",
          requestedAt: now,
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

    let warning: string | null = null
    let driveStatus: "provisioned" | "pending" = "provisioned"
    let projectDriveUrl: string | null = null
    try {
      const drive = await provisionGoogleProjectDriveFolder(
        googleClients.drive,
        submittingGoogleEmail,
        { department, folderName: driveFolderName }
      )
      projectDriveUrl = drive.folderUrl
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
                templateFolderId: projectDriveTemplateFolderId(department),
                childFolderNames: drive.childFolderNames,
                copiedFileCount: drive.copiedFileCount,
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

    const registryRow = buildProjectRegistryRow({
      layout: registryLayout,
      project: trackerProject,
      projectNumber,
      driveFolderUrl: projectDriveUrl,
      departmentTrackerUrl: spreadsheetUrl(
        departmentDestination.spreadsheetId
      ),
      createdBy: user.displayName ?? user.email,
    })
    const departmentRow = buildDepartmentTrackerRow({
      layout: departmentLayout,
      project: trackerProject,
      projectNumber,
      driveFolderUrl: projectDriveUrl,
    })
    let registryWrite: Awaited<ReturnType<typeof appendProjectRowIfMissing>> | null =
      null
    let departmentWrite: Awaited<ReturnType<typeof appendProjectRowIfMissing>> | null =
      null
    try {
      registryWrite = await appendProjectRowIfMissing({
        sheets: googleClients.sheets,
        googleEmail: projectIntakeGoogleEmail,
        spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
        sheetTitle: PROJECT_REGISTRY_DESTINATION.sheetTitle,
        rows: registryRows,
        layout: registryLayout,
        projectNumber,
        row: registryRow,
      })
    } catch (error) {
      warning = appendWarning(
        warning,
        "The Compass project is safe, but the Developer Project Registry write is pending. Do not recreate the project."
      )
      console.error("Unable to write the Developer Project Registry", error)
    }
    try {
      departmentWrite = await appendProjectRowIfMissing({
        sheets: googleClients.sheets,
        googleEmail: projectIntakeGoogleEmail,
        spreadsheetId: departmentDestination.spreadsheetId,
        sheetTitle: departmentDestination.sheetTitle,
        rows: departmentRows,
        layout: departmentLayout,
        projectNumber,
        row: departmentRow,
      })
    } catch (error) {
      warning = appendWarning(
        warning,
        `The Compass project is safe, but the ${departmentDestination.workbookTitle} write is pending. Do not recreate the project.`
      )
      console.error(
        `Unable to write ${departmentDestination.workbookTitle}`,
        error
      )
    }
    const trackerStatus: "written" | "pending" =
      registryWrite && departmentWrite ? "written" : "pending"
    const trackingSyncedAt = new Date().toISOString()
    try {
      await db.batch([
        db
          .update(projectExternalLinks)
          .set({
            syncStatus: registryWrite ? "mapped" : "pending",
            lastSyncedAt: registryWrite ? trackingSyncedAt : null,
            metadata: JSON.stringify({
              sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
              updatedRange: registryWrite?.updatedRange ?? null,
              alreadyPresent: registryWrite?.alreadyPresent ?? false,
            }),
            updatedAt: trackingSyncedAt,
          })
          .where(eq(projectExternalLinks.id, registryLinkId)),
        db
          .update(projectExternalLinks)
          .set({
            syncStatus: departmentWrite ? "mapped" : "pending",
            lastSyncedAt: departmentWrite ? trackingSyncedAt : null,
            metadata: JSON.stringify({
              sheet: departmentDestination.sheetTitle,
              department,
              updatedRange: departmentWrite?.updatedRange ?? null,
              alreadyPresent: departmentWrite?.alreadyPresent ?? false,
            }),
            updatedAt: trackingSyncedAt,
          })
          .where(eq(projectExternalLinks.id, departmentTrackerLinkId)),
        db
          .update(projectOperations)
          .set({
            status: trackerStatus === "written" ? "completed" : "open",
            syncStatus: trackerStatus === "written" ? "mapped" : "pending",
            lastSyncedAt:
              trackerStatus === "written" ? trackingSyncedAt : null,
            updatedAt: trackingSyncedAt,
          })
          .where(eq(projectOperations.id, operationId)),
      ])
    } catch (error) {
      warning = appendWarning(
        warning,
        "Google tracking rows were handled, but Compass could not save every sync receipt. Reconcile by project number; do not resend the intake."
      )
      console.error("Unable to save Developer tracker receipts", error)
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
      metadata: {
        department,
        trackerStatus,
        driveStatus,
        sageStatus: sageWriteApproved ? "queued" : "approval_required",
      },
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
      sageStatus: sageWriteApproved ? "queued" : "approval_required",
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
      readonly copiedFileCount: number
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
      {
        department,
        folderName,
        existingFolderId: project.googleDriveFolderId ?? undefined,
      }
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
        templateFolderId: projectDriveTemplateFolderId(department),
        childFolderNames: drive.childFolderNames,
        copiedFileCount: drive.copiedFileCount,
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
        copiedFileCount: drive.copiedFileCount,
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
      copiedFileCount: drive.copiedFileCount,
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
      const rows = await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
          clientName: projects.clientName,
          googleDriveFolderId: projects.googleDriveFolderId,
          status: projects.status,
          clientStatus: projects.clientStatus,
          jobStatusId: projects.jobStatusId,
          customJobStatusLabel: projectJobStatuses.label,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .leftJoin(
          projectJobStatuses,
          and(
            eq(projectJobStatuses.id, projects.jobStatusId),
            eq(projectJobStatuses.organizationId, projects.organizationId),
          ),
        )
        .where(eq(projects.organizationId, user.organizationId))
        .orderBy(asc(projects.projectNumber), asc(projects.name))
      return projectListItems(rows)
    }

    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        googleDriveFolderId: projects.googleDriveFolderId,
        status: projects.status,
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
        customJobStatusLabel: projectJobStatuses.label,
        createdAt: projects.createdAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .leftJoin(
        projectJobStatuses,
        and(
          eq(projectJobStatuses.id, projects.jobStatusId),
          eq(projectJobStatuses.organizationId, projects.organizationId),
        ),
      )
      .where(eq(projectMembers.userId, user.id))
      .orderBy(asc(projects.projectNumber), asc(projects.name))
    return projectListItems(rows)
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
    const clientName = requireText(input.clientName ?? "", "Client")
    const status = cleanText(input.status) ?? "OPEN"
    const sageClientStatusId = parseSageClientStatusId(input.sageClientStatusId)
    if (!sageClientStatusId) {
      return { success: false, error: "Choose a Sage client status." }
    }
    const sageJobStatus = PROJECT_JOB_STATUS_DEFINITIONS.find(
      (option) => option.id === input.sageJobStatusId
    )
    if (!sageJobStatus) {
      return { success: false, error: "Choose a Sage job status." }
    }
    const sageJobType = parseSageJobTypeId(input.sageJobType)
    if (!sageJobType) {
      return { success: false, error: "Choose a Sage job type." }
    }
    const approved = await isSageWriteApproved(db, orgId, user.id)

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
    const customerMatch = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
        )
      )
      .limit(1)
      .get()
    const customerId = customerMatch?.id ?? crypto.randomUUID()
    const address = cleanText(input.address)
    const fullSageJobName = sageJobName(projectNumber, name)
    const payload = {
      operationType: "ensure_client_and_job" as const,
      company: "High Performance Structures Inc" as const,
      client: {
        compassCustomerId: customerId,
        name: clientName,
        shortName: sageShortName(clientName),
        company: null,
        email: null,
        phone: null,
        address,
        billingAddress: address,
        notes: null,
        status: {
          expectedNumber: sageClientStatusId,
          name: sageClientStatusName(sageClientStatusId),
        },
      },
      job: {
        compassProjectId: id,
        compassProjectNumber: projectNumber,
        name: fullSageJobName,
        shortName: sageShortName(fullSageJobName),
        address,
        statusName: sageJobStatus.label,
        typeName: sageJobTypeName(sageJobType),
      },
    }

    await db.batch([
      db.insert(projects).values({
        id,
        organizationId: orgId,
        projectNumber,
        department:
          normalizedIntakeDepartment(input.department) ??
          projectDepartment(projectNumber),
        name,
        status,
        address,
        clientName,
        clientStatus: "customer",
        jobStatusId: sageJobStatus.id,
        sageJobStatusName: sageJobStatus.label,
        sageJobTypeName: sageJobTypeName(sageJobType),
        ownerUpdatesEnabled: true,
        ownerUpdateChannel: "compass",
        ownerUpdateCadence: "weekly",
        createdAt: now,
        updatedAt: now,
      }),
      customerMatch
        ? db
            .update(customers)
            .set({ sageClientStatusId, updatedAt: now })
            .where(eq(customers.id, customerId))
        : db.insert(customers).values({
            id: customerId,
            organizationId: orgId,
            name: clientName,
            address,
            sageClientStatusId,
            createdAt: now,
            updatedAt: now,
          }),
      db.insert(projectContacts).values({
        id: crypto.randomUUID(),
        projectId: id,
        contactType: "owner",
        sourceSystem: "customer_directory",
        sourceRecordId: customerId,
        sourceEntityType: "customer",
        sourceEntityId: customerId,
        displayName: clientName,
        companyName: customerMatch?.company ?? null,
        role: "Owner / Client",
        email: customerMatch?.email ?? null,
        phone: customerMatch?.phone ?? null,
        address: customerMatch?.address ?? address,
        notes: null,
        ownerPortalVisible: true,
        subVendorPortalVisible: false,
        internalVisible: true,
        primaryContact: true,
        active: true,
        sortOrder: 100,
        syncStatus: "manual",
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(projectExternalLinks).values({
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
      }),
      db.insert(sageClientProjectWriteOperations).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        customerId,
        projectId: id,
        requestedByUserId: user.id,
        operationType: "ensure_client_and_job",
        idempotencyKey: `project:${id}`,
        payloadJson: JSON.stringify(payload),
        status: approved ? "queued" : "approval_required",
        requestedAt: now,
        updatedAt: now,
      }),
    ])

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${id}`)
    revalidatePath("/dashboard")
    return {
      success: true,
      id,
      sageStatus: approved ? "queued" : "approval_required",
    }
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
