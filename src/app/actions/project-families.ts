"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectChangeOrders,
  customers,
  projectContacts,
  projectExternalLinks,
  projectJobStatuses,
  projectNumberAliases,
  projectProfileAuditEvents,
  projectProfileSyncOperations,
  projects,
} from "@/db/schema"
import {
  projectFamilies,
  projectFamilyPhases,
} from "@/db/schema-project-families"
import { requireAuth } from "@/lib/auth"
import {
  createProjectShell,
  type CreateProjectShellInput,
} from "@/app/actions/projects"
import { getCloudflareContext } from "@/lib/db"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"
import {
  getProjectAccessRecord,
  usesOrganizationProjectScope,
} from "@/lib/project-access"
import {
  isBuiltInProjectJobStatusId,
  projectJobStatusLabel,
} from "@/lib/project-profile"
import {
  baseProjectNumber,
  projectNumberPhaseNumber,
} from "@/lib/project-profile"
import {
  projectFamilyPhaseDriveFolderName,
  projectFamilyProjectNumber,
} from "@/lib/project-family"
import { projectWorkspaceClients } from "@/lib/google/project-workspace"
import type { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  buildDepartmentTrackerRow,
  buildProjectRegistryRow,
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  projectRowNumber,
  PROJECT_REGISTRY_DESTINATION,
  type ProjectIntakeDepartment,
  type ProjectIntakeTrackerInput,
  type ProjectTrackerLayout,
} from "@/lib/google/project-intake-tracker"
import {
  provisionProjectDriveFolder as provisionGoogleProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"
import { requireOrg } from "@/lib/org-scope"
import {
  parseSageClientStatusId,
  parseSageJobTypeId,
} from "@/lib/sage/client-project-write"

export type ProjectFamilyPhaseSummary = {
  readonly id: string
  readonly sequence: number
  readonly name: string
  readonly description: string | null
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly projectId: string | null
  readonly projectNumber: string | null
  readonly projectName: string | null
  readonly projectStatus: string | null
  readonly googleDriveFolderId: string | null
  readonly originatingChangeOrder: {
    readonly id: string
    readonly number: string
    readonly title: string
    readonly status: string
    readonly amountCents: number | null
  } | null
  readonly authorizedContractAmountCents: number | null
  readonly authorizedAt: string | null
}

export type ProjectFamilySummary = {
  readonly family: {
    readonly id: string
    readonly name: string
    readonly description: string | null
    readonly clientName: string | null
    readonly address: string | null
    readonly status: string
    readonly googleDriveFolderId: string | null
  }
  readonly currentPhaseId: string
  readonly phases: readonly ProjectFamilyPhaseSummary[]
}

export type CreateProjectFamilyInput = {
  readonly name: string
  readonly description: string | null
  readonly clientName: string | null
  readonly address: string | null
  readonly googleDriveFolderId: string | null
}

export type CreateProjectFamilyPhaseInput = {
  readonly familyId: string
  readonly sequence: number
  readonly name: string
  readonly description: string | null
  readonly jobStatusId: string
  readonly originatingChangeOrderId: string | null
  readonly authorizedContractAmountCents: number | null
  readonly authorizedAt: string | null
}

export type LinkProjectToFamilyPhaseInput = {
  readonly phaseId: string
  readonly projectId: string
}

export type LinkExistingProjectToFamilyInput = {
  readonly familyId: string
  readonly projectNumber: string
  readonly sequence: number
  readonly phaseName: string
}

export type CreateProjectFamilyFromProjectInput = {
  readonly projectId: string
  readonly familyName: string
  readonly phaseName: string
}

export type ProjectFamilyMutationResult =
  | {
      readonly success: true
      readonly id: string
      readonly projectNumber?: string
      readonly driveStatus?: "provisioned" | "pending"
      readonly warning?: string | null
    }
  | { readonly success: false; readonly error: string }

type ProjectFamilyPhaseRow = {
  readonly phase: typeof projectFamilyPhases.$inferSelect
  readonly customJobStatusLabel: string | null
  readonly projectNumber: string | null
  readonly phaseProjectNumber: string | null
  readonly projectName: string | null
  readonly projectStatus: string | null
  readonly googleDriveFolderId: string | null
  readonly phaseGoogleDriveFolderId: string | null
  readonly changeOrderId: string | null
  readonly changeOrderNumber: string | null
  readonly changeOrderTitle: string | null
  readonly changeOrderStatus: string | null
  readonly changeOrderAmountCents: number | null
}

function phaseSummary(
  row: ProjectFamilyPhaseRow,
  includeGovernance: boolean,
): ProjectFamilyPhaseSummary {
  const changeOrder =
    row.changeOrderId &&
    row.changeOrderNumber &&
    row.changeOrderTitle &&
    row.changeOrderStatus
      ? {
          id: row.changeOrderId,
          number: row.changeOrderNumber,
          title: row.changeOrderTitle,
          status: row.changeOrderStatus,
          amountCents: row.changeOrderAmountCents,
        }
      : null

  return {
    id: row.phase.id,
    sequence: row.phase.sequence,
    name: row.phase.name,
    description: row.phase.description,
    jobStatusId: row.phase.jobStatusId,
    jobStatusLabel: projectJobStatusLabel({
      jobStatusId: row.phase.jobStatusId,
      customLabel: row.customJobStatusLabel,
    }),
    projectId: row.phase.projectId,
    projectNumber: row.projectNumber ?? row.phaseProjectNumber,
    projectName: row.projectName,
    projectStatus: row.projectStatus,
    googleDriveFolderId:
      row.googleDriveFolderId ?? row.phaseGoogleDriveFolderId,
    originatingChangeOrder: includeGovernance ? changeOrder : null,
    authorizedContractAmountCents: includeGovernance
      ? row.phase.authorizedContractAmountCents
      : null,
    authorizedAt: includeGovernance ? row.phase.authorizedAt : null,
  }
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(value: string, label: string, maximumLength: number): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`)
  }
  return cleaned
}

function nullableLimitedText(
  value: string | null,
  label: string,
  maximumLength: number,
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`)
  }
  return cleaned
}

async function requireFamilyAdminContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly organizationId: string
  readonly environment: CloudflareEnv
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  if (!canManageProjectRegistry(user)) {
    throw new Error("Permission denied: project family management is admin-only")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("D1 not available")
  return { db: getDb(env.DB), user, organizationId, environment: env }
}

type PhaseDriveProvisioningResult =
  | {
      readonly success: true
      readonly folderId: string
      readonly folderUrl: string
    }
  | { readonly success: false; readonly error: string }

function projectFamilyDepartment(
  projectNumber: string,
): "O" | "H" | "N" | "D" | null {
  const prefix = projectNumber.trim().slice(0, 1).toUpperCase()
  return prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D"
    ? prefix
    : null
}

async function provisionPhaseDriveFolder(
  context: Awaited<ReturnType<typeof requireFamilyAdminContext>>,
  phaseId: string,
): Promise<PhaseDriveProvisioningResult> {
  const phase = await context.db
    .select({
      phaseId: projectFamilyPhases.id,
      familyId: projectFamilyPhases.familyId,
      phaseName: projectFamilyPhases.name,
      phaseProjectNumber: projectFamilyPhases.projectNumber,
      phaseFolderId: projectFamilyPhases.googleDriveFolderId,
      linkedProjectNumber: projects.projectNumber,
      linkedProjectFolderId: projects.googleDriveFolderId,
      familyFolderId: projectFamilies.googleDriveFolderId,
    })
    .from(projectFamilyPhases)
    .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .where(
      and(
        eq(projectFamilyPhases.id, phaseId),
        eq(projectFamilies.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!phase) return { success: false, error: "Project phase not found." }

  if (phase.phaseFolderId) {
    return {
      success: true,
      folderId: phase.phaseFolderId,
      folderUrl: `https://drive.google.com/drive/folders/${phase.phaseFolderId}`,
    }
  }

  const projectNumber =
    phase.phaseProjectNumber ?? phase.linkedProjectNumber ?? null
  if (!projectNumber) {
    return {
      success: false,
      error: "Assign the phase a project number before provisioning Drive.",
    }
  }
  const department = projectFamilyDepartment(projectNumber)
  if (!department) {
    return { success: false, error: "The phased project number has no valid department." }
  }

  let parentFolderId = phase.familyFolderId
  if (!parentFolderId) {
      const basePhase = await context.db
      .select({
        phaseFolderId: projectFamilyPhases.googleDriveFolderId,
        linkedProjectFolderId: projects.googleDriveFolderId,
      })
      .from(projectFamilyPhases)
      .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
      .where(
        and(
          eq(projectFamilyPhases.familyId, phase.familyId),
          eq(projectFamilyPhases.sequence, 1),
        ),
      )
      .limit(1)
      .get()
    parentFolderId =
      basePhase?.phaseFolderId ?? basePhase?.linkedProjectFolderId ?? null
    if (parentFolderId) {
      await context.db
        .update(projectFamilies)
        .set({ googleDriveFolderId: parentFolderId, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(projectFamilies.organizationId, context.organizationId),
            eq(projectFamilies.id, phase.familyId),
          ),
        )
    }
  }
  if (!parentFolderId) {
    return {
      success: false,
      error: "The base project is not mapped to a Google Drive folder yet.",
    }
  }

  const googleClients = await projectWorkspaceClients({
    environment: context.environment,
    organizationId: context.organizationId,
  })
  const drive = await provisionGoogleProjectDriveFolder(
    googleClients.drive,
    context.user.googleEmail ?? context.user.email,
    {
      department,
      folderName: projectFamilyPhaseDriveFolderName({
        projectNumber,
        phaseName: phase.phaseName,
      }),
      existingFolderId: phase.phaseFolderId ?? undefined,
      parentFolderId,
    },
  )
  await context.db
    .update(projectFamilyPhases)
    .set({
      projectNumber,
      googleDriveFolderId: drive.folderId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectFamilyPhases.id, phase.phaseId))
  return { success: true, folderId: drive.folderId, folderUrl: drive.folderUrl }
}

async function saveProjectDriveMapping(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly folderId: string
  readonly folderUrl: string
  readonly phaseId: string
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_drive"),
      ),
    )
    .limit(1)
    .get()
  const values = {
    label: "Project Drive folder",
    externalId: input.folderId,
    externalNumber: null,
    externalUrl: input.folderUrl,
    syncDirection: "read_write",
    syncStatus: "mapped",
    metadata: JSON.stringify({ projectFamilyPhaseId: input.phaseId }),
    lastSyncedAt: input.now,
    updatedAt: input.now,
  }
  if (existing) {
    await input.db
      .update(projectExternalLinks)
      .set(values)
      .where(eq(projectExternalLinks.id, existing.id))
    return
  }
  await input.db.insert(projectExternalLinks).values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    system: "google_drive",
    createdAt: input.now,
    ...values,
  })
}

type PhaseTrackerWrite = {
  readonly updatedRange: string | null
  readonly alreadyPresent: boolean
}

function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replaceAll("'", "''")}'!${range}`
}

async function appendPhaseTrackerRowIfMissing(input: {
  readonly sheets: SheetsClient
  readonly googleEmail: string
  readonly spreadsheetId: string
  readonly sheetTitle: string
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>
  readonly layout: ProjectTrackerLayout
  readonly projectNumber: string
  readonly row: readonly string[]
}): Promise<PhaseTrackerWrite> {
  const existingRow = projectRowNumber(
    input.rows,
    input.layout,
    input.projectNumber,
  )
  if (existingRow !== null) {
    return {
      updatedRange: quotedSheetRange(input.sheetTitle, `A${existingRow}:AZ${existingRow}`),
      alreadyPresent: true,
    }
  }
  const appended = await input.sheets.appendValues(input.googleEmail, {
    spreadsheetId: input.spreadsheetId,
    range: quotedSheetRange(
      input.sheetTitle,
      `A${input.layout.headerRowNumber}:AZ`,
    ),
    values: [input.row],
  })
  return {
    updatedRange: appended.updatedRange,
    alreadyPresent: false,
  }
}

function phaseAddressParts(address: string | null): {
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
} {
  const parts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  const street = parts[0] ?? ""
  const match = /^(\S+)\s+(.+)$/.exec(street)
  return {
    streetNumber: match?.[1] ?? null,
    streetName: match?.[2] ?? (street || null),
    cityStateZip: parts.slice(1).join(", ") || null,
  }
}

function phaseTrackerInput(input: {
  readonly department: ProjectIntakeDepartment
  readonly phaseName: string
  readonly clientName: string | null
  readonly address: string | null
  readonly projectManager: string | null
  readonly intakeDate: string
}): ProjectIntakeTrackerInput {
  const clientName = cleanText(input.clientName)
  const nameParts = clientName?.split(/\s+/).filter(Boolean) ?? []
  const address = phaseAddressParts(input.address)
  return {
    department: input.department,
    projectName: input.phaseName,
    clientName,
    companyName: null,
    clientFirstName: nameParts[0] ?? null,
    clientLastName: nameParts.slice(1).join(" ") || null,
    contactPhone: null,
    contactEmail: null,
    streetNumber: address.streetNumber,
    streetName: address.streetName,
    cityStateZip: address.cityStateZip,
    billingAddress: null,
    assignedTo: cleanText(input.projectManager),
    referredBy: null,
    notes: "Created from an authorized project family phase.",
    intakeDate: input.intakeDate,
  }
}

async function syncPhaseTrackerRows(input: {
  readonly context: Awaited<ReturnType<typeof requireFamilyAdminContext>>
  readonly phase: { readonly name: string }
  readonly project: {
    readonly projectNumber: string
    readonly clientName: string | null
    readonly address: string | null
    readonly projectManager: string | null
    readonly googleDriveFolderId: string | null
  }
  readonly now: string
}): Promise<{
  readonly registry: PhaseTrackerWrite
  readonly department: PhaseTrackerWrite
}> {
  const department = projectFamilyDepartment(input.project.projectNumber)
  if (!department) throw new Error("The phase project has no supported department.")
  const googleClients = await projectWorkspaceClients({
    environment: input.context.environment,
    organizationId: input.context.organizationId,
  })
  const trackerEmail = googleClients.projectIntakeGoogleEmail
  const departmentDestination = departmentTrackingDestination(department)
  const [registryRows, departmentRows] = await Promise.all([
    googleClients.sheets.getValues(trackerEmail, {
      spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      range: quotedSheetRange(PROJECT_REGISTRY_DESTINATION.sheetTitle, "A:ZZ"),
    }),
    googleClients.sheets.getValues(trackerEmail, {
      spreadsheetId: departmentDestination.spreadsheetId,
      range: quotedSheetRange(departmentDestination.sheetTitle, "A:ZZ"),
    }),
  ])
  const registryLayout = locateProjectTrackerLayout(registryRows)
  const departmentLayout = locateProjectTrackerLayout(departmentRows)
  if (!registryLayout || !departmentLayout) {
    throw new Error("The Developer Project Registry or department Tracker headers could not be identified.")
  }
  const trackerProject = phaseTrackerInput({
    department,
    phaseName: input.phase.name,
    clientName: input.project.clientName,
    address: input.project.address,
    projectManager: input.project.projectManager,
    intakeDate: input.now.slice(0, 10),
  })
  const driveFolderUrl = input.project.googleDriveFolderId
    ? `https://drive.google.com/drive/folders/${input.project.googleDriveFolderId}`
    : null
  const registry = await appendPhaseTrackerRowIfMissing({
    sheets: googleClients.sheets,
    googleEmail: trackerEmail,
    spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
    sheetTitle: PROJECT_REGISTRY_DESTINATION.sheetTitle,
    rows: registryRows,
    layout: registryLayout,
    projectNumber: input.project.projectNumber,
    row: buildProjectRegistryRow({
      layout: registryLayout,
      project: trackerProject,
      projectNumber: input.project.projectNumber,
      driveFolderUrl,
      departmentTrackerUrl: `https://docs.google.com/spreadsheets/d/${departmentDestination.spreadsheetId}`,
      createdBy: input.context.user.displayName ?? input.context.user.email,
    }),
  })
  const departmentWrite = await appendPhaseTrackerRowIfMissing({
    sheets: googleClients.sheets,
    googleEmail: trackerEmail,
    spreadsheetId: departmentDestination.spreadsheetId,
    sheetTitle: departmentDestination.sheetTitle,
    rows: departmentRows,
    layout: departmentLayout,
    projectNumber: input.project.projectNumber,
    row: buildDepartmentTrackerRow({
      layout: departmentLayout,
      project: trackerProject,
      projectNumber: input.project.projectNumber,
      driveFolderUrl,
    }),
  })
  return { registry, department: departmentWrite }
}

async function savePhaseTrackerLink(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly system: "google_project_registry" | "google_department_tracker"
  readonly label: string
  readonly spreadsheetId: string
  readonly projectNumber: string
  readonly syncStatus: "mapped" | "pending"
  readonly metadata: Record<string, unknown>
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, input.system),
      ),
    )
    .limit(1)
    .get()
  const values = {
    label: input.label,
    externalId: input.spreadsheetId,
    externalNumber: input.projectNumber,
    externalUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
    syncDirection: "bidirectional",
    syncStatus: input.syncStatus,
    metadata: JSON.stringify(input.metadata),
    lastSyncedAt: input.syncStatus === "mapped" ? input.now : null,
    updatedAt: input.now,
  }
  if (existing) {
    await input.db
      .update(projectExternalLinks)
      .set(values)
      .where(eq(projectExternalLinks.id, existing.id))
    return
  }
  await input.db.insert(projectExternalLinks).values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    system: input.system,
    createdAt: input.now,
    ...values,
  })
}

export async function createProjectFamily(
  input: CreateProjectFamilyInput,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const now = new Date().toISOString()
    const id = `family-${crypto.randomUUID()}`
    await context.db.insert(projectFamilies).values({
      id,
      organizationId: context.organizationId,
      name: requiredText(input.name, "Family name", 200),
      description: nullableLimitedText(input.description, "Description", 4_000),
      clientName: nullableLimitedText(input.clientName, "Client", 200),
      address: nullableLimitedText(input.address, "Address", 500),
      status: "OPEN",
      googleDriveFolderId: nullableLimitedText(
        input.googleDriveFolderId,
        "Google Drive folder ID",
        300,
      ),
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    revalidatePath("/dashboard/projects")
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to create project family.",
    }
  }
}

/**
 * Seeds the family model around an existing project without creating any
 * additional project, contract, or change-order records.
 */
export async function createProjectFamilyFromProject(
  input: CreateProjectFamilyFromProjectInput,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const project = await context.db
      .select({
        id: projects.id,
        name: projects.name,
        clientName: projects.clientName,
        address: projects.address,
        jobStatusId: projects.jobStatusId,
        projectNumber: projects.projectNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!project) return { success: false, error: "Project not found." }

    const existingPhase = await context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, input.projectId))
      .limit(1)
      .get()
    if (existingPhase) {
      return { success: false, error: "This project already belongs to a project family." }
    }

    const now = new Date().toISOString()
    const familyId = `family-${crypto.randomUUID()}`
    const phaseId = crypto.randomUUID()
    const familyName = requiredText(
      input.familyName || project.name,
      "Family name",
      200,
    )
    const phaseName = requiredText(
      input.phaseName || project.name,
      "Phase name",
      200,
    )
    await context.db.batch([
      context.db.insert(projectFamilies).values({
        id: familyId,
        organizationId: context.organizationId,
        name: familyName,
        description: null,
        clientName: project.clientName,
        address: project.address,
        status: "OPEN",
        googleDriveFolderId: project.googleDriveFolderId,
        createdBy: context.user.id,
        createdAt: now,
        updatedAt: now,
      }),
      context.db.insert(projectFamilyPhases).values({
        id: phaseId,
        familyId,
        projectId: project.id,
        projectNumber: project.projectNumber,
        googleDriveFolderId: project.googleDriveFolderId,
        sequence: 1,
        name: phaseName,
        description: null,
        jobStatusId: project.jobStatusId,
        originatingChangeOrderId: null,
        authorizedContractAmountCents: null,
        authorizedAt: null,
        createdBy: context.user.id,
        createdAt: now,
        updatedAt: now,
      }),
    ])
    revalidatePath(`/dashboard/projects/${input.projectId}`)
    revalidatePath("/dashboard/projects")
    return { success: true, id: familyId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create a project family from this project.",
    }
  }
}

export async function createProjectFamilyPhase(
  input: CreateProjectFamilyPhaseInput,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    if (!Number.isInteger(input.sequence) || input.sequence < 2) {
      return {
        success: false,
        error:
          "Additional phase sequence must be 2 or greater; the original project is phase 1.",
      }
    }
    if (
      input.authorizedContractAmountCents !== null &&
      (!Number.isSafeInteger(input.authorizedContractAmountCents) ||
        input.authorizedContractAmountCents < 0)
    ) {
      return { success: false, error: "Authorized contract amount is invalid." }
    }
    const family = await context.db
      .select({
        id: projectFamilies.id,
      })
      .from(projectFamilies)
      .where(
        and(
          eq(projectFamilies.id, input.familyId),
          eq(projectFamilies.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!family) return { success: false, error: "Project family not found." }

    const basePhase = await context.db
      .select({
        projectId: projectFamilyPhases.projectId,
        phaseProjectNumber: projectFamilyPhases.projectNumber,
        projectNumber: projects.projectNumber,
      })
      .from(projectFamilyPhases)
      .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
      .where(
        and(
          eq(projectFamilyPhases.familyId, input.familyId),
          eq(projectFamilyPhases.sequence, 1),
        ),
      )
      .limit(1)
      .get()
    if (!basePhase) {
      return {
        success: false,
        error: "Create the family from its original project before adding phases.",
      }
    }
    const familyBaseNumber = basePhase.phaseProjectNumber ?? basePhase.projectNumber
    if (!familyBaseNumber) {
      return {
        success: false,
        error: "The original project needs a valid project number before adding phases.",
      }
    }
    const projectNumber = projectFamilyProjectNumber(
      familyBaseNumber,
      input.sequence,
    )
    if (!projectNumber) {
      return {
        success: false,
        error: "Compass could not build the phased project number.",
      }
    }

    const customStatus = await context.db
      .select({ id: projectJobStatuses.id })
      .from(projectJobStatuses)
      .where(
        and(
          eq(projectJobStatuses.id, input.jobStatusId),
          eq(projectJobStatuses.organizationId, context.organizationId),
          eq(projectJobStatuses.active, true),
        ),
      )
      .limit(1)
      .get()
    if (!isBuiltInProjectJobStatusId(input.jobStatusId) && !customStatus) {
      return { success: false, error: "Choose a valid phase job status." }
    }

    const existingSequence = await context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .where(
        and(
          eq(projectFamilyPhases.familyId, input.familyId),
          eq(projectFamilyPhases.sequence, input.sequence),
        ),
      )
      .limit(1)
      .get()
    if (existingSequence) {
      return {
        success: false,
        error: "That phase sequence is already used in this family.",
      }
    }

    const [existingProject, existingPhaseNumber] = await Promise.all([
      context.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, context.organizationId),
            eq(projects.projectNumber, projectNumber),
          ),
        )
        .limit(1)
        .get(),
      context.db
        .select({ id: projectFamilyPhases.id })
        .from(projectFamilyPhases)
        .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
        .where(
          and(
            eq(projectFamilyPhases.projectNumber, projectNumber),
            eq(projectFamilies.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .get(),
    ])
    if (existingProject || existingPhaseNumber) {
      return {
        success: false,
        error: `Project number ${projectNumber} is already in use.`,
      }
    }

    if (input.originatingChangeOrderId) {
      const originatingChangeOrder = await context.db
        .select({ projectId: projectChangeOrders.projectId })
        .from(projectChangeOrders)
        .innerJoin(projects, eq(projects.id, projectChangeOrders.projectId))
        .where(
          and(
            eq(projectChangeOrders.id, input.originatingChangeOrderId),
            eq(projects.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .get()
      if (!originatingChangeOrder) {
        return { success: false, error: "Originating change order not found." }
      }
      const sourcePhase = await context.db
        .select({ familyId: projectFamilyPhases.familyId })
        .from(projectFamilyPhases)
        .where(eq(projectFamilyPhases.projectId, originatingChangeOrder.projectId))
        .limit(1)
        .get()
      if (!sourcePhase || sourcePhase.familyId !== input.familyId) {
        return {
          success: false,
          error: "The originating change order must belong to this project family.",
        }
      }
    }

    const phaseName = requiredText(input.name, "Phase name", 200)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await context.db.insert(projectFamilyPhases).values({
      id,
      familyId: input.familyId,
      projectId: null,
      projectNumber,
      googleDriveFolderId: null,
      sequence: input.sequence,
      name: phaseName,
      description: nullableLimitedText(input.description, "Description", 4_000),
      jobStatusId: input.jobStatusId,
      originatingChangeOrderId: cleanText(input.originatingChangeOrderId),
      authorizedContractAmountCents: input.authorizedContractAmountCents,
      authorizedAt: cleanText(input.authorizedAt),
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    let driveStatus: "provisioned" | "pending" = "pending"
    let warning: string | null = null
    try {
      const drive = await provisionPhaseDriveFolder(context, id)
      if (!drive.success) {
        warning = drive.error
      } else {
        driveStatus = "provisioned"
      }
    } catch (error) {
      warning =
        error instanceof Error
          ? error.message
          : "Google Drive setup is pending for this phase."
    }
    revalidatePath("/dashboard/projects")
    if (basePhase.projectId) revalidatePath(`/dashboard/projects/${basePhase.projectId}`)
    return { success: true, id, projectNumber, driveStatus, warning }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to create project phase.",
    }
  }
}

/**
 * Turns an authorized planned phase into a normal Compass project. The phase
 * number is supplied by the family record so this path cannot accidentally
 * consume the next top-level project sequence.
 */
export async function activateProjectFamilyPhase(
  phaseId: string,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const phase = await context.db
      .select({
        id: projectFamilyPhases.id,
        familyId: projectFamilyPhases.familyId,
        projectId: projectFamilyPhases.projectId,
        projectNumber: projectFamilyPhases.projectNumber,
        name: projectFamilyPhases.name,
        jobStatusId: projectFamilyPhases.jobStatusId,
        authorizedAt: projectFamilyPhases.authorizedAt,
        originatingChangeOrderId: projectFamilyPhases.originatingChangeOrderId,
      })
      .from(projectFamilyPhases)
      .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
      .where(
        and(
          eq(projectFamilyPhases.id, phaseId),
          eq(projectFamilies.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!phase) return { success: false, error: "Project phase not found." }
    if (phase.projectId) {
      return {
        success: false,
        error: "This phase is already an active Compass project.",
      }
    }
    if (!phase.projectNumber) {
      return { success: false, error: "The phase does not have a project number." }
    }
    if (!phase.authorizedAt && !phase.originatingChangeOrderId) {
      return {
        success: false,
        error: "Authorize the phase with contract data or an originating change order before creating its Sage project.",
      }
    }
    const phaseNumber = projectNumberPhaseNumber(phase.projectNumber)
    const baseNumber = baseProjectNumber(phase.projectNumber)
    if (phaseNumber === null || !baseNumber) {
      return { success: false, error: "The phase number is not a valid phased project number." }
    }

    const baseProject = await context.db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        department: projects.department,
        name: projects.name,
        status: projects.status,
        address: projects.address,
        clientName: projects.clientName,
        projectManager: projects.projectManager,
        sageJobTypeName: projects.sageJobTypeName,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, context.organizationId),
          eq(projects.projectNumber, baseNumber),
        ),
      )
      .limit(1)
      .get()
    if (!baseProject) {
      return { success: false, error: "The original project for this phase was not found." }
    }
    const department = projectFamilyDepartment(baseNumber)
    if (!department) {
      return { success: false, error: "The original project has no supported department." }
    }
    const customer = await context.db
      .select({ sageClientStatusId: customers.sageClientStatusId })
      .from(projectContacts)
      .innerJoin(customers, eq(customers.id, projectContacts.sourceEntityId))
      .where(
        and(
          eq(projectContacts.projectId, baseProject.id),
          eq(projectContacts.sourceEntityType, "customer"),
        ),
      )
      .limit(1)
      .get()
    const shellInput: CreateProjectShellInput = {
      projectNumber: phase.projectNumber,
      name: phase.name,
      department,
      clientName: baseProject.clientName,
      address: baseProject.address,
      status: baseProject.status,
      sageClientStatusId:
        parseSageClientStatusId(customer?.sageClientStatusId) ?? 1,
      sageJobStatusId: phase.jobStatusId,
      sageJobType:
        parseSageJobTypeId(baseProject.sageJobTypeName?.toLowerCase() ?? "customer") ??
        "customer",
      confirmedDistinctProjectIds: [baseProject.id],
    }
    const created = await createProjectShell(shellInput)
    if (!created.success) {
      if ("error" in created) return { success: false, error: created.error }
      return {
        success: false,
        error: "A possible duplicate project must be reviewed before activating this phase.",
      }
    }

    const linked = await linkProjectToFamilyPhase({
      phaseId,
      projectId: created.id,
    })
    if (!linked.success) {
      return {
        success: false,
        error: `Phase project ${phase.projectNumber} was created, but Compass could not finish linking it: ${linked.error}`,
      }
    }

    const project = await context.db
      .select({
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        address: projects.address,
        projectManager: projects.projectManager,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.id, created.id))
      .limit(1)
      .get()
    if (!project?.projectNumber) {
      return {
        success: false,
        error: "Phase project was created, but its project number could not be read back.",
      }
    }

    const now = new Date().toISOString()
    let warning = linked.warning ?? null
    try {
      const trackerWrites = await syncPhaseTrackerRows({
        context,
        phase,
        project: {
          projectNumber: project.projectNumber,
          clientName: project.clientName,
          address: project.address,
          projectManager: project.projectManager,
          googleDriveFolderId: project.googleDriveFolderId,
        },
        now,
      })
      await Promise.all([
        savePhaseTrackerLink({
          db: context.db,
          projectId: created.id,
          system: "google_project_registry",
          label: PROJECT_REGISTRY_DESTINATION.workbookTitle,
          spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
          projectNumber: project.projectNumber,
          syncStatus: "mapped",
          metadata: {
            sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
            updatedRange: trackerWrites.registry.updatedRange,
            alreadyPresent: trackerWrites.registry.alreadyPresent,
          },
          now,
        }),
        savePhaseTrackerLink({
          db: context.db,
          projectId: created.id,
          system: "google_department_tracker",
          label: `${department} department tracker`,
          spreadsheetId: departmentTrackingDestination(department).spreadsheetId,
          projectNumber: project.projectNumber,
          syncStatus: "mapped",
          metadata: {
            sheet: departmentTrackingDestination(department).sheetTitle,
            updatedRange: trackerWrites.department.updatedRange,
            alreadyPresent: trackerWrites.department.alreadyPresent,
          },
          now,
        }),
      ])
    } catch (error) {
      warning = warning
        ? `${warning} Registry/tracker sync is pending: ${error instanceof Error ? error.message : "Google Sheets could not be updated."}`
        : `Registry/tracker sync is pending: ${error instanceof Error ? error.message : "Google Sheets could not be updated."}`
      await Promise.all([
        savePhaseTrackerLink({
          db: context.db,
          projectId: created.id,
          system: "google_project_registry",
          label: PROJECT_REGISTRY_DESTINATION.workbookTitle,
          spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
          projectNumber: project.projectNumber,
          syncStatus: "pending",
          metadata: { sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle, error: warning },
          now,
        }),
        savePhaseTrackerLink({
          db: context.db,
          projectId: created.id,
          system: "google_department_tracker",
          label: `${department} department tracker`,
          spreadsheetId: departmentTrackingDestination(department).spreadsheetId,
          projectNumber: project.projectNumber,
          syncStatus: "pending",
          metadata: { sheet: departmentTrackingDestination(department).sheetTitle, error: warning },
          now,
        }),
      ])
    }

    revalidatePath(`/dashboard/projects/${created.id}`)
    revalidatePath(`/dashboard/projects/${baseProject.id}`)
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: created.id,
      projectNumber: project.projectNumber,
      driveStatus: linked.driveStatus,
      warning,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to activate the project phase.",
    }
  }
}

export async function linkProjectToFamilyPhase(
  input: LinkProjectToFamilyPhaseInput,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const phase = await context.db
      .select({
        id: projectFamilyPhases.id,
        familyId: projectFamilyPhases.familyId,
        projectId: projectFamilyPhases.projectId,
        projectNumber: projectFamilyPhases.projectNumber,
        googleDriveFolderId: projectFamilyPhases.googleDriveFolderId,
      })
      .from(projectFamilyPhases)
      .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
      .where(
        and(
          eq(projectFamilyPhases.id, input.phaseId),
          eq(projectFamilies.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!phase) return { success: false, error: "Project phase not found." }
    if (phase.projectId && phase.projectId !== input.projectId) {
      return { success: false, error: "This phase is already linked to a project." }
    }

    const project = await context.db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!project) return { success: false, error: "Project not found." }
    if (
      phase.projectNumber &&
      project.projectNumber !== phase.projectNumber
    ) {
      return {
        success: false,
        error: `Link the project numbered ${phase.projectNumber} to this phase.`,
      }
    }
    if (
      phase.googleDriveFolderId &&
      project.googleDriveFolderId &&
      phase.googleDriveFolderId !== project.googleDriveFolderId
    ) {
      return {
        success: false,
        error:
          "This project already has a different Drive folder. Move or reconcile that folder before linking the phase.",
      }
    }
    if (!phase.googleDriveFolderId && project.googleDriveFolderId) {
      return {
        success: false,
        error:
          "This project already has a Drive folder outside the family parent. Move it into the phase folder before linking.",
      }
    }

    const existingPhase = await context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, input.projectId))
      .limit(1)
      .get()
    if (existingPhase && existingPhase.id !== phase.id) {
      return { success: false, error: "Project is already linked to another phase." }
    }

    const now = new Date().toISOString()
    await context.db
      .update(projectFamilyPhases)
      .set({
        projectId: input.projectId,
        projectNumber: phase.projectNumber ?? project.projectNumber,
        googleDriveFolderId: phase.googleDriveFolderId,
        updatedAt: now,
      })
      .where(eq(projectFamilyPhases.id, phase.id))
    let driveStatus: "provisioned" | "pending" = phase.googleDriveFolderId
      ? "provisioned"
      : "pending"
    let warning: string | null = null
    let folderId = phase.googleDriveFolderId
    let folderUrl = folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : null
    if (!phase.googleDriveFolderId) {
      try {
        const drive = await provisionPhaseDriveFolder(context, phase.id)
        if (!drive.success) {
          warning = drive.error
        } else {
          driveStatus = "provisioned"
          folderId = drive.folderId
          folderUrl = drive.folderUrl
        }
      } catch (error) {
        warning =
          error instanceof Error
            ? error.message
            : "Google Drive setup is pending for this phase."
      }
    }
    if (folderId && folderUrl) {
      const mappedAt = new Date().toISOString()
      await context.db
        .update(projects)
        .set({ googleDriveFolderId: folderId, updatedAt: mappedAt })
        .where(eq(projects.id, input.projectId))
      await saveProjectDriveMapping({
        db: context.db,
        projectId: input.projectId,
        folderId,
        folderUrl,
        phaseId: phase.id,
        now: mappedAt,
      })
    }
    revalidatePath(`/dashboard/projects/${input.projectId}`)
    revalidatePath("/dashboard/projects")
    return { success: true, id: phase.id, driveStatus, warning }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to link project phase.",
    }
  }
}

/**
 * Adopts an existing Compass project as a family phase. The project record and
 * every record linked to it remain intact. When its legacy number differs from
 * the family's canonical phase number, Compass retains the old number as an
 * alias and queues the existing Drive/tracker synchronization workflow.
 */
export async function linkExistingProjectToFamily(
  input: LinkExistingProjectToFamilyInput,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 2) {
      return { success: false, error: "Choose Phase 2 or later." }
    }

    const family = await context.db
      .select({ id: projectFamilies.id })
      .from(projectFamilies)
      .where(
        and(
          eq(projectFamilies.id, input.familyId),
          eq(projectFamilies.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get()
    if (!family) return { success: false, error: "Project family not found." }

    const basePhase = await context.db
      .select({
        projectId: projectFamilyPhases.projectId,
        phaseProjectNumber: projectFamilyPhases.projectNumber,
        projectNumber: projects.projectNumber,
      })
      .from(projectFamilyPhases)
      .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
      .where(
        and(
          eq(projectFamilyPhases.familyId, input.familyId),
          eq(projectFamilyPhases.sequence, 1),
        ),
      )
      .limit(1)
      .get()
    const familyBaseNumber =
      basePhase?.phaseProjectNumber ?? basePhase?.projectNumber ?? null
    if (!basePhase || !familyBaseNumber) {
      return {
        success: false,
        error: "The family needs an original numbered project before linking phases.",
      }
    }
    const canonicalProjectNumber = projectFamilyProjectNumber(
      familyBaseNumber,
      input.sequence,
    )
    if (!canonicalProjectNumber) {
      return { success: false, error: "Compass could not build the phase number." }
    }
    const canonicalDepartment = projectFamilyDepartment(canonicalProjectNumber)
    if (!canonicalDepartment) {
      return { success: false, error: "The family has no valid department." }
    }

    const requestedProjectNumber = requiredText(
      input.projectNumber,
      "Existing project number",
      100,
    ).toUpperCase()
    const project = await context.db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        department: projects.department,
        jobStatusId: projects.jobStatusId,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, context.organizationId),
          eq(projects.projectNumber, requestedProjectNumber),
        ),
      )
      .limit(1)
      .get()
    if (!project || !project.projectNumber) {
      return { success: false, error: "Existing project not found." }
    }
    if (project.id === basePhase.projectId) {
      return { success: false, error: "The original project is already Phase 1." }
    }
    const existingNumberDepartment = projectFamilyDepartment(project.projectNumber)
    if (
      (existingNumberDepartment && existingNumberDepartment !== canonicalDepartment) ||
      (project.department && project.department !== canonicalDepartment)
    ) {
      return {
        success: false,
        error: "An existing project can only be linked to a family in the same department.",
      }
    }

    const [
      sequenceConflict,
      linkedConflict,
      projectNumberConflict,
      aliasConflict,
      phaseNumberConflict,
    ] =
      await Promise.all([
        context.db
          .select({ id: projectFamilyPhases.id })
          .from(projectFamilyPhases)
          .where(
            and(
              eq(projectFamilyPhases.familyId, input.familyId),
              eq(projectFamilyPhases.sequence, input.sequence),
            ),
          )
          .limit(1)
          .get(),
        context.db
          .select({ id: projectFamilyPhases.id })
          .from(projectFamilyPhases)
          .where(eq(projectFamilyPhases.projectId, project.id))
          .limit(1)
          .get(),
        context.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, context.organizationId),
              eq(projects.projectNumber, canonicalProjectNumber),
            ),
          )
          .limit(1)
          .get(),
        context.db
          .select({ projectId: projectNumberAliases.projectId })
          .from(projectNumberAliases)
          .where(
            and(
              eq(projectNumberAliases.organizationId, context.organizationId),
              eq(projectNumberAliases.projectNumber, canonicalProjectNumber),
            ),
          )
          .limit(1)
          .get(),
        context.db
          .select({ id: projectFamilyPhases.id })
          .from(projectFamilyPhases)
          .innerJoin(
            projectFamilies,
            eq(projectFamilies.id, projectFamilyPhases.familyId),
          )
          .where(
            and(
              eq(projectFamilies.organizationId, context.organizationId),
              eq(projectFamilyPhases.projectNumber, canonicalProjectNumber),
            ),
          )
          .limit(1)
          .get(),
      ])
    if (sequenceConflict) {
      return { success: false, error: "That phase is already used in this family." }
    }
    if (linkedConflict) {
      return { success: false, error: "That project already belongs to a family." }
    }
    if (projectNumberConflict && projectNumberConflict.id !== project.id) {
      return { success: false, error: `${canonicalProjectNumber} is already in use.` }
    }
    if (aliasConflict && aliasConflict.projectId !== project.id) {
      return {
        success: false,
        error: `${canonicalProjectNumber} is a historical number for another project.`,
      }
    }
    if (phaseNumberConflict) {
      return {
        success: false,
        error: `${canonicalProjectNumber} is already assigned to a planned phase.`,
      }
    }

    const phaseName = requiredText(
      input.phaseName || project.name,
      "Phase name",
      200,
    )
    const now = new Date().toISOString()
    const phaseId = crypto.randomUUID()
    const changedNumber = project.projectNumber !== canonicalProjectNumber
    const phaseInsert = context.db.insert(projectFamilyPhases).values({
      id: phaseId,
      familyId: input.familyId,
      projectId: project.id,
      projectNumber: canonicalProjectNumber,
      googleDriveFolderId: project.googleDriveFolderId,
      sequence: input.sequence,
      name: phaseName,
      description: "Linked from an existing Compass project.",
      jobStatusId: project.jobStatusId,
      originatingChangeOrderId: null,
      authorizedContractAmountCents: null,
      authorizedAt: null,
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    const auditInsert = context.db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      projectId: project.id,
      actorUserId: context.user.id,
      eventType: "project.family_phase_linked_existing",
      entityType: "project_family_phase",
      entityId: phaseId,
      beforeJson: JSON.stringify({
        projectNumber: project.projectNumber,
        familyId: null,
      }),
      afterJson: JSON.stringify({
        projectNumber: canonicalProjectNumber,
        previousProjectNumber: changedNumber ? project.projectNumber : null,
        familyId: input.familyId,
        sequence: input.sequence,
      }),
      createdAt: now,
    })

    if (changedNumber) {
      const syncPayload = JSON.stringify({
        previousProjectNumber: project.projectNumber,
        projectNumber: canonicalProjectNumber,
      })
      await context.db.batch([
        phaseInsert,
        context.db
          .update(projects)
          .set({
            projectNumber: canonicalProjectNumber,
            department: canonicalDepartment,
            updatedAt: now,
          })
          .where(
            and(
              eq(projects.id, project.id),
              eq(projects.organizationId, context.organizationId),
            ),
          ),
        context.db
          .insert(projectNumberAliases)
          .values({
            id: crypto.randomUUID(),
            organizationId: context.organizationId,
            projectId: project.id,
            projectNumber: project.projectNumber,
            createdBy: context.user.id,
            createdAt: now,
          })
          .onConflictDoNothing(),
        context.db
          .update(projectExternalLinks)
          .set({ externalNumber: canonicalProjectNumber, updatedAt: now })
          .where(
            and(
              eq(projectExternalLinks.projectId, project.id),
              eq(projectExternalLinks.externalNumber, project.projectNumber),
            ),
          ),
        context.db.insert(projectProfileSyncOperations).values([
          {
            id: crypto.randomUUID(),
            organizationId: context.organizationId,
            projectId: project.id,
            operation: "drive_folder_rename",
            status: "pending",
            payloadJson: syncPayload,
            error: null,
            attempts: 0,
            attemptedAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: crypto.randomUUID(),
            organizationId: context.organizationId,
            projectId: project.id,
            operation: "tracker_row_update",
            status: "pending",
            payloadJson: syncPayload,
            error: null,
            attempts: 0,
            attemptedAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
        auditInsert,
      ])
    } else if (project.department !== canonicalDepartment) {
      await context.db.batch([
        phaseInsert,
        context.db
          .update(projects)
          .set({ department: canonicalDepartment, updatedAt: now })
          .where(
            and(
              eq(projects.id, project.id),
              eq(projects.organizationId, context.organizationId),
            ),
          ),
        auditInsert,
      ])
    } else {
      await context.db.batch([phaseInsert, auditInsert])
    }

    revalidatePath(`/dashboard/projects/${project.id}`)
    if (basePhase.projectId) {
      revalidatePath(`/dashboard/projects/${basePhase.projectId}`)
    }
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: phaseId,
      projectNumber: canonicalProjectNumber,
      driveStatus: project.googleDriveFolderId ? "provisioned" : "pending",
      warning: changedNumber
        ? "The old project number was retained as an alias. Drive and tracker renames are queued."
        : null,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to link the existing project as a phase.",
    }
  }
}

export async function provisionProjectFamilyPhaseDriveFolder(
  phaseId: string,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const drive = await provisionPhaseDriveFolder(context, phaseId)
    if (!drive.success) return { success: false, error: drive.error }
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: phaseId,
      driveStatus: "provisioned",
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to provision the phase Drive folder.",
    }
  }
}

/**
 * Reads the family context for a project without widening project access.
 * Planned phases are visible only to users who can see the family internally;
 * external/project-scoped users see only sibling phases they can access.
 */
export async function getProjectFamilySummary(
  projectId: string,
): Promise<ProjectFamilySummary | null> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")

  const { env } = await getCloudflareContext()
  if (!env?.DB) return null

  const db = getDb(env.DB)
  const projectAccess = await getProjectAccessRecord(db, user, projectId)
  if (!projectAccess) return null

  const phase = await db
    .select({ familyId: projectFamilyPhases.familyId })
    .from(projectFamilyPhases)
    .where(eq(projectFamilyPhases.projectId, projectId))
    .limit(1)
    .get()
  if (!phase) return null

  const family = await db
    .select()
    .from(projectFamilies)
    .where(eq(projectFamilies.id, phase.familyId))
    .limit(1)
    .get()
  if (!family) return null

  const canSeeAllPhases =
    family.organizationId !== null &&
    usesOrganizationProjectScope(user, family.organizationId)

  const rows = await db
    .select({
      phase: projectFamilyPhases,
      customJobStatusLabel: projectJobStatuses.label,
      projectNumber: projects.projectNumber,
      phaseProjectNumber: projectFamilyPhases.projectNumber,
      projectName: projects.name,
      projectStatus: projects.status,
      googleDriveFolderId: projects.googleDriveFolderId,
      phaseGoogleDriveFolderId: projectFamilyPhases.googleDriveFolderId,
      changeOrderId: projectChangeOrders.id,
      changeOrderNumber: projectChangeOrders.changeOrderNumber,
      changeOrderTitle: projectChangeOrders.title,
      changeOrderStatus: projectChangeOrders.status,
      changeOrderAmountCents: projectChangeOrders.amountCents,
    })
    .from(projectFamilyPhases)
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .leftJoin(
      projectJobStatuses,
      and(
        eq(projectJobStatuses.id, projectFamilyPhases.jobStatusId),
        eq(projectJobStatuses.organizationId, family.organizationId),
      ),
    )
    .leftJoin(
      projectChangeOrders,
      eq(projectChangeOrders.id, projectFamilyPhases.originatingChangeOrderId),
    )
    .where(eq(projectFamilyPhases.familyId, family.id))
    .orderBy(asc(projectFamilyPhases.sequence))

  const visibleRows: ProjectFamilyPhaseRow[] = []
  for (const row of rows) {
    if (canSeeAllPhases || row.phase.projectId === projectId) {
      visibleRows.push(row)
      continue
    }
    if (row.phase.projectId) {
      const siblingAccess = await getProjectAccessRecord(
        db,
        user,
        row.phase.projectId,
      )
      if (siblingAccess) visibleRows.push(row)
    }
  }

  return {
    family: {
      id: family.id,
      name: family.name,
      description: family.description,
      clientName: family.clientName,
      address: family.address,
      status: family.status,
      // Do not expose a shared Drive root to a user who cannot see every
      // phase; the root could reveal sibling folders outside Compass.
      googleDriveFolderId: canSeeAllPhases ? family.googleDriveFolderId : null,
    },
    currentPhaseId:
      rows.find((row) => row.phase.projectId === projectId)?.phase.id ?? "",
    phases: visibleRows.map((row) => phaseSummary(row, canSeeAllPhases)),
  }
}
