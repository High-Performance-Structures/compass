"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  customers,
  internalContacts,
  organizationMembers,
  projectContacts,
  projectDuplicateDecisions,
  projectExternalLinks,
  projectJobStatuses,
  projectMembers,
  projectNumberReservations,
  projectOperations,
  projectRegistryRemovals,
  projectNumberRetirements,
  projectRouteAliases,
  projects,
  users,
} from "@/db/schema"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import {
  projectFamilies,
  projectFamilyPhases,
} from "@/db/schema-project-families"
import { and, asc, eq, notExists, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import type { SheetsClient } from "@/lib/google/client/sheets-client"
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
import { projectWorkspaceClients } from "@/lib/google/project-workspace"
import { requireOrg } from "@/lib/org-scope"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"
import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import { findProspectiveProjectDuplicates } from "@/lib/project-duplicate-store"
import {
  PROJECT_JOB_STATUS_DEFINITIONS,
  projectJobStatusLabel,
} from "@/lib/project-profile"
import {
  parseSageClientStatusId,
  parseSageJobTypeId,
  sageClientStatusName,
  sageJobName,
  sageJobTypeName,
  sageShortName,
  type SageClientStatusId,
  type SageJobTypeId,
} from "@/lib/sage/client-project-write"
import { sageClientLinkReviewIds } from "@/lib/sage/client-link-review"

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
  readonly confirmedDistinctProjectIds?: readonly string[]
}

type CreateProjectShellResult =
  | {
      readonly success: true
      readonly id: string
      readonly sageStatus: "queued"
    }
  | {
      readonly success: false
      readonly duplicateWarning: true
      readonly candidates: readonly ProjectDuplicateCandidate[]
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

export type ProjectIntakeCustomerOption = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly sageClientStatusId: number | null
  readonly sageLinkNeedsReview: boolean
}

export async function getProjectIntakeCustomerOptions(): Promise<readonly ProjectIntakeCustomerOption[]> {
  const user = await requireAuth()
  requirePermission(user, "project", "create")
  const { requireFeaturePermission } = await import("@/lib/permission-enforcement")
  await requireFeaturePermission(user, "customers", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db.select({
    id: customers.id,
    name: customers.name,
    company: customers.company,
    email: customers.email,
    phone: customers.phone,
    sageClientStatusId: customers.sageClientStatusId,
    sageClientId: customers.sageClientId,
    sageClientNumber: customers.sageClientNumber,
  })
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
    .orderBy(asc(customers.name))
  const reviewIds = sageClientLinkReviewIds(rows)
  return rows.map((customer) => ({
    id: customer.id,
    name: customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    sageClientStatusId: customer.sageClientStatusId,
    sageLinkNeedsReview: reviewIds.has(customer.id),
  }))
}

export type CreateProjectIntakeInput = Omit<
  ProjectIntakeTrackerInput,
  "intakeDate"
> & {
  readonly existingCustomerId?: string | null
  readonly sageClientStatusId: SageClientStatusId
  readonly sageJobStatusId: string
  readonly sageJobType: SageJobTypeId
  readonly confirmedDistinctProjectIds?: readonly string[]
}

export type CreateProjectIntakeResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber: string
      readonly trackerStatus: "written" | "pending"
      readonly driveStatus: "provisioned" | "pending"
      readonly sageStatus: "queued"
      readonly warning: string | null
    }
  | {
      readonly success: false
      readonly duplicateWarning: true
      readonly candidates: readonly ProjectDuplicateCandidate[]
    }
  | { readonly success: false; readonly error: string }

function candidateExistingProjectId(
  candidate: ProjectDuplicateCandidate,
): string {
  return candidate.second.id
}

function orderedProjectPair(
  firstProjectId: string,
  secondProjectId: string,
): readonly [string, string] {
  return firstProjectId < secondProjectId
    ? [firstProjectId, secondProjectId]
    : [secondProjectId, firstProjectId]
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function hasIncompleteSageClientLink(customer: {
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
} | null): boolean {
  return customer !== null && Boolean(customer.sageClientId) !== Boolean(customer.sageClientNumber)
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
    const department = normalizedIntakeDepartment(input.department)
    if (!department) {
      return { success: false, error: "Choose ORC, HPS, Nu-Tech, or Design." }
    }
    const duplicateCandidates = await findProspectiveProjectDuplicates(
      db,
      organizationId,
      {
        projectNumber: null,
        name: projectName,
        clientName,
        address: joinedAddress(input),
        sageJobId: null,
        sageJobNumber: null,
        googleDriveFolderId: null,
        buildertrendProjectId: null,
      },
    )
    const confirmedDistinctProjectIds = new Set(
      input.confirmedDistinctProjectIds ?? [],
    )
    const unconfirmedDuplicateCandidates = duplicateCandidates.filter(
      (candidate) =>
        !confirmedDistinctProjectIds.has(candidateExistingProjectId(candidate)),
    )
    if (unconfirmedDuplicateCandidates.length > 0) {
      return {
        success: false,
        duplicateWarning: true,
        candidates: unconfirmedDuplicateCandidates,
      }
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
    const [reservations, retirements] = await Promise.all([
      db.select({ projectNumber: projectNumberReservations.projectNumber }).from(projectNumberReservations).where(and(eq(projectNumberReservations.organizationId, organizationId), eq(projectNumberReservations.department, department))),
      db.select({ projectNumber: projectNumberRetirements.projectNumber }).from(projectNumberRetirements).where(and(eq(projectNumberRetirements.organizationId, organizationId), eq(projectNumberRetirements.department, department))),
    ])
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
        retirements.map((retirement) => retirement.projectNumber),
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

    const selectedCustomerId = cleanText(input.existingCustomerId ?? null)
    const customerEmail = cleanText(input.contactEmail)?.toLowerCase() ?? null
    const customerMatches = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          selectedCustomerId
            ? eq(customers.id, selectedCustomerId)
            : customerEmail
            ? or(
                sql`lower(trim(${customers.email})) = ${customerEmail}`,
                sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
              )
            : sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
        )
      )
      .limit(2)
    if (selectedCustomerId && customerMatches.length === 0) {
      return { success: false, error: "The selected client is no longer in this directory. Refresh and choose it again." }
    }
    if (customerMatches.length > 1) {
      return {
        success: false,
        error: "More than one client directory record matches this intake. Select or reconcile the exact client before creating the project.",
      }
    }
    if (!selectedCustomerId && customerMatches.length > 0) {
      return {
        success: false,
        error: "This client already exists in Contacts. Choose the exact client from the directory list before creating the project.",
      }
    }
    const customerMatch = selectedCustomerId ? customerMatches[0] ?? null : null
    const sameNameCustomers = customerMatch
      ? await db.select({
          id: customers.id,
          name: customers.name,
          sageClientId: customers.sageClientId,
          sageClientNumber: customers.sageClientNumber,
        }).from(customers).where(and(
          eq(customers.organizationId, organizationId),
          sql`lower(trim(${customers.name})) = ${customerMatch.name.trim().toLowerCase()}`,
        ))
      : []
    if (customerMatch && sageClientLinkReviewIds(sameNameCustomers).has(customerMatch.id)) {
      return {
        success: false,
        error: "This client has an incomplete or same-name Sage link candidate. Reconcile the exact Sage ID and number in Contacts before creating the project.",
      }
    }
    if (customerMatch?.sageClientStatusId != null && customerMatch.sageClientStatusId !== sageClientStatusId) {
      return {
        success: false,
        error: "The selected client has a different Sage status. Use its directory status or reconcile it in Contacts before creating the project.",
      }
    }
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
    const assigneeDirectory = assignee
      ? await db
          .select({
            id: internalContacts.id,
            name: internalContacts.name,
            email: internalContacts.email,
            phone: internalContacts.phone,
            active: internalContacts.active,
          })
          .from(internalContacts)
          .where(
            and(
              eq(internalContacts.organizationId, organizationId),
              eq(internalContacts.userId, assignee.id)
            )
          )
          .get()
      : null
    if (assigneeDirectory && !assigneeDirectory.active) {
      return { success: false, error: "The assigned staff member is inactive in the internal contact directory." }
    }
    const assigneeDirectoryId = assignee
      ? assigneeDirectory?.id ?? crypto.randomUUID()
      : null

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
    const driveFolderName = buildProjectDriveFolderName({
      projectNumber,
      projectName,
      streetNumber: input.streetNumber,
      streetName: input.streetName,
    })
    const customerValues = {
      id: customerId,
      organizationId,
      name: customerMatch?.name ?? clientName,
      company: customerMatch ? customerMatch.company : cleanText(input.companyName),
      email: customerMatch ? customerMatch.email : cleanText(input.contactEmail),
      phone: customerMatch ? customerMatch.phone : cleanText(input.contactPhone),
      address: customerMatch
        ? customerMatch.address
        : cleanText(input.billingAddress) ?? joinedAddress(input),
      notes: customerMatch ? customerMatch.notes : cleanText(input.notes),
      sageClientStatusId,
      createdAt: now,
      updatedAt: now,
    }
    // Intake creates an assignment. Existing directory details remain canonical.
    const trackerProject: ProjectIntakeTrackerInput = {
      ...input,
      department,
      projectName,
      intakeDate,
      clientName: customerValues.name,
      companyName: customerValues.company,
      contactEmail: customerValues.email,
      contactPhone: customerValues.phone,
    }
    const fullSageJobName = sageJobName(projectNumber, projectName)
    const sageWritePayload = {
      operationType: "ensure_client_and_job" as const,
      company: "High Performance Structures Inc" as const,
      client: {
        compassCustomerId: customerId,
        sageClientId: customerMatch?.sageClientId ?? null,
        sageClientNumber: customerMatch?.sageClientNumber ?? null,
        name: customerValues.name,
        shortName: sageShortName(customerValues.company ?? customerValues.name),
        company: customerValues.company,
        email: customerValues.email,
        phone: customerValues.phone,
        address: customerValues.address,
        billingAddress: customerMatch ? null : cleanText(input.billingAddress),
        notes: customerValues.notes,
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
          clientName: customerValues.name,
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
        ...(assignee && assigneeDirectoryId && !assigneeDirectory
          ? [db.insert(internalContacts).values({
              id: assigneeDirectoryId,
              organizationId,
              userId: assignee.id,
              name: projectManagerName ?? assignee.email,
              email: assignee.email,
              phone: assignee.phone,
              sourceSystem: "compass_user",
              sourceRecordId: assignee.id,
              active: true,
              syncStatus: "manual",
              createdAt: now,
              updatedAt: now,
            })]
          : []),
        ...(!customerMatch
          ? [db.insert(customers).values(customerValues)]
          : customerMatch.sageClientStatusId === null &&
            !customerMatch.sageClientId && !customerMatch.sageClientNumber
            ? [db.update(customers)
                .set({ sageClientStatusId, updatedAt: now })
                .where(eq(customers.id, customerId))]
            : []),
        db.insert(projectContacts).values({
          id: ownerContactId,
          projectId,
          contactType: "owner",
          sourceSystem: "customer_directory",
          sourceRecordId: customerId,
          sourceEntityType: "customer",
          sourceEntityId: customerId,
          displayName: customerValues.name,
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
                  ? "internal_directory"
                  : "compass_project_intake",
                sourceRecordId: assigneeDirectoryId ?? projectId,
                sourceEntityType: assignee ? "internal_contact" : "manual",
                sourceEntityId: assigneeDirectoryId,
                internalContactId: assigneeDirectoryId,
                displayName: assigneeDirectory?.name ?? projectManagerName ?? assignedTo,
                companyName: null,
                role: "Project manager",
                email: assigneeDirectory?.email ?? assignee?.email ?? null,
                phone: assigneeDirectory?.phone ?? assignee?.phone ?? null,
                address: null,
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
          description:
            "Compass intake queued for the narrow Sage client/job writer.",
          status: "open",
          priority: "high",
          assigneeType: "internal",
          assigneeName: cleanText(input.assignedTo),
          companyName: intakeClientName(input),
          externalUrl: null,
          sageWriteStatus: "queued",
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
          status: "queued",
          requestedAt: now,
          updatedAt: now,
        }),
        ...duplicateCandidates.map((candidate) => {
          const existingProjectId = candidateExistingProjectId(candidate)
          const [projectAId, projectBId] = orderedProjectPair(
            projectId,
            existingProjectId,
          )
          return db.insert(projectDuplicateDecisions).values({
            id: crypto.randomUUID(),
            organizationId,
            projectAId,
            projectBId,
            status: "not_duplicate",
            keptProjectId: null,
            removedProjectId: null,
            score: candidate.score,
            reasonsJson: JSON.stringify(candidate.reasons),
            removedProjectSnapshotJson: null,
            resolvedByUserId: user.id,
            resolvedAt: now,
            createdAt: now,
            updatedAt: now,
          })
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
        sageStatus: "queued",
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
      sageStatus: "queued",
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
    const [familyPhase] = await db
      .select({
        phaseId: projectFamilyPhases.id,
        familyId: projectFamilyPhases.familyId,
        sequence: projectFamilyPhases.sequence,
        phaseFolderId: projectFamilyPhases.googleDriveFolderId,
        familyFolderId: projectFamilies.googleDriveFolderId,
      })
      .from(projectFamilyPhases)
      .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
      .where(
        and(
          eq(projectFamilyPhases.projectId, projectId),
          eq(projectFamilies.organizationId, organizationId),
        ),
      )
      .limit(1)
    let familyParentFolderId =
      familyPhase?.sequence && familyPhase.sequence > 1
        ? familyPhase.familyFolderId
        : null
    if (familyPhase?.sequence && familyPhase.sequence > 1 && !familyParentFolderId) {
      const basePhase = await db
        .select({
          phaseFolderId: projectFamilyPhases.googleDriveFolderId,
          linkedProjectFolderId: projects.googleDriveFolderId,
        })
        .from(projectFamilyPhases)
        .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
        .where(
          and(
            eq(projectFamilyPhases.familyId, familyPhase.familyId),
            eq(projectFamilyPhases.sequence, 1),
          ),
        )
        .limit(1)
        .get()
      familyParentFolderId =
        basePhase?.phaseFolderId ?? basePhase?.linkedProjectFolderId ?? null
      if (familyParentFolderId) {
        await db
          .update(projectFamilies)
          .set({
            googleDriveFolderId: familyParentFolderId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(projectFamilies.id, familyPhase.familyId))
      }
    }
    if (familyPhase?.sequence && familyPhase.sequence > 1 && !familyParentFolderId) {
      return {
        success: false,
        error: "The family base project is not mapped to a Google Drive folder yet.",
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
      {
        department,
        folderName,
        existingFolderId:
          project.googleDriveFolderId ?? familyPhase?.phaseFolderId ?? undefined,
        parentFolderId:
          familyPhase?.sequence && familyPhase.sequence > 1
            ? familyParentFolderId ?? undefined
            : undefined,
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
    const phaseUpdate = familyPhase
      ? db
          .update(projectFamilyPhases)
          .set({
            projectNumber: project.projectNumber,
            googleDriveFolderId: drive.folderId,
            updatedAt: now,
          })
          .where(eq(projectFamilyPhases.id, familyPhase.phaseId))
      : null
    const familyUpdate =
      familyPhase?.sequence === 1
        ? db
            .update(projectFamilies)
            .set({ googleDriveFolderId: drive.folderId, updatedAt: now })
            .where(eq(projectFamilies.id, familyPhase.familyId))
        : null
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
        ...(phaseUpdate ? [phaseUpdate] : []),
        ...(familyUpdate ? [familyUpdate] : []),
        db
          .update(projectExternalLinks)
          .set(linkValues)
          .where(eq(projectExternalLinks.id, driveLink.id)),
      ])
    } else {
      await db.batch([
        projectUpdate,
        sageOperationUpdate,
        ...(phaseUpdate ? [phaseUpdate] : []),
        ...(familyUpdate ? [familyUpdate] : []),
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
        .where(
          and(
            eq(projects.organizationId, user.organizationId),
            notExists(
              db
                .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
                .from(projectRouteAliases)
                .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
            ),
            notExists(db.select({ projectId: projectRegistryRemovals.projectId }).from(projectRegistryRemovals).where(eq(projectRegistryRemovals.projectId, projects.id))),
            notExists(
              db
                .select({
                  removedProjectId:
                    projectDuplicateDecisions.removedProjectId,
                })
                .from(projectDuplicateDecisions)
                .where(
                  and(
                    eq(projectDuplicateDecisions.status, "merged"),
                    eq(projectDuplicateDecisions.removedProjectId, projects.id),
                  ),
                ),
            ),
          ),
        )
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
      .where(
        and(
          eq(projectMembers.userId, user.id),
          notExists(
            db
              .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
              .from(projectRouteAliases)
              .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
          ),
          notExists(db.select({ projectId: projectRegistryRemovals.projectId }).from(projectRegistryRemovals).where(eq(projectRegistryRemovals.projectId, projects.id))),
          notExists(
            db
              .select({
                removedProjectId: projectDuplicateDecisions.removedProjectId,
              })
              .from(projectDuplicateDecisions)
              .where(
                and(
                  eq(projectDuplicateDecisions.status, "merged"),
                  eq(projectDuplicateDecisions.removedProjectId, projects.id),
                ),
              ),
          ),
        ),
      )
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
    const builtInSageJobStatus = PROJECT_JOB_STATUS_DEFINITIONS.find(
      (option) => option.id === input.sageJobStatusId
    )
    const customSageJobStatus = builtInSageJobStatus
      ? null
      : await db
          .select({ id: projectJobStatuses.id, label: projectJobStatuses.label })
          .from(projectJobStatuses)
          .where(
            and(
              eq(projectJobStatuses.id, input.sageJobStatusId),
              eq(projectJobStatuses.organizationId, orgId),
              eq(projectJobStatuses.active, true),
            ),
          )
          .limit(1)
          .get()
    const sageJobStatus = builtInSageJobStatus ?? customSageJobStatus
    if (!sageJobStatus) {
      return { success: false, error: "Choose a Sage job status." }
    }
    const sageJobType = parseSageJobTypeId(input.sageJobType)
    if (!sageJobType) {
      return { success: false, error: "Choose a Sage job type." }
    }
    const duplicateCandidates = await findProspectiveProjectDuplicates(
      db,
      orgId,
      {
        projectNumber,
        name,
        clientName,
        address: cleanText(input.address),
        sageJobId: null,
        sageJobNumber: null,
        googleDriveFolderId: null,
        buildertrendProjectId: null,
      },
    )
    const confirmedDistinctProjectIds = new Set(
      input.confirmedDistinctProjectIds ?? [],
    )
    const unconfirmedDuplicateCandidates = duplicateCandidates.filter(
      (candidate) =>
        !confirmedDistinctProjectIds.has(candidateExistingProjectId(candidate)),
    )
    if (unconfirmedDuplicateCandidates.length > 0) {
      return {
        success: false,
        duplicateWarning: true,
        candidates: unconfirmedDuplicateCandidates,
      }
    }
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
    const customerMatches = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
        )
      )
      .limit(2)
    if (customerMatches.length > 1) {
      return {
        success: false,
        error: "More than one client directory record matches this name. Reconcile the exact client before creating the project.",
      }
    }
    const customerMatch = customerMatches[0] ?? null
    if (hasIncompleteSageClientLink(customerMatch)) {
      return {
        success: false,
        error: "This client has an incomplete Sage link. Reconcile its Sage ID and number in Contacts before creating the project.",
      }
    }
    if (customerMatch?.sageClientStatusId != null && customerMatch.sageClientStatusId !== sageClientStatusId) {
      return {
        success: false,
        error: "This client has a different Sage status. Reconcile it in Contacts before creating the project.",
      }
    }
    const customerId = customerMatch?.id ?? crypto.randomUUID()
    const address = cleanText(input.address)
    const fullSageJobName = sageJobName(projectNumber, name)
    const payload = {
      operationType: "ensure_client_and_job" as const,
      company: "High Performance Structures Inc" as const,
      client: {
        compassCustomerId: customerId,
        sageClientId: customerMatch?.sageClientId ?? null,
        sageClientNumber: customerMatch?.sageClientNumber ?? null,
        name: customerMatch?.name ?? clientName,
        shortName: sageShortName(customerMatch?.name ?? clientName),
        company: customerMatch?.company ?? null,
        email: customerMatch?.email ?? null,
        phone: customerMatch?.phone ?? null,
        address: customerMatch?.address ?? address,
        billingAddress: customerMatch?.sageClientId || customerMatch?.sageClientNumber ? null : address,
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
      ...(!customerMatch
        ? [db.insert(customers).values({
            id: customerId,
            organizationId: orgId,
            name: clientName,
            address,
            sageClientStatusId,
            createdAt: now,
            updatedAt: now,
          })]
        : customerMatch.sageClientStatusId === null &&
          !customerMatch.sageClientId && !customerMatch.sageClientNumber
          ? [db.update(customers)
              .set({ sageClientStatusId, updatedAt: now })
              .where(eq(customers.id, customerId))]
          : []),
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
        status: "queued",
        requestedAt: now,
        updatedAt: now,
      }),
      ...duplicateCandidates.map((candidate) => {
        const existingProjectId = candidateExistingProjectId(candidate)
        const [projectAId, projectBId] = orderedProjectPair(
          id,
          existingProjectId,
        )
        return db.insert(projectDuplicateDecisions).values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          projectAId,
          projectBId,
          status: "not_duplicate",
          keptProjectId: null,
          removedProjectId: null,
          score: candidate.score,
          reasonsJson: JSON.stringify(candidate.reasons),
          removedProjectSnapshotJson: null,
          resolvedByUserId: user.id,
          resolvedAt: now,
          createdAt: now,
          updatedAt: now,
        })
      }),
    ])

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${id}`)
    revalidatePath("/dashboard")
    return {
      success: true,
      id,
      sageStatus: "queued",
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
