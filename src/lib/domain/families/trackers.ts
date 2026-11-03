/**
 * The Developer Project Registry and department tracker rows for an
 * activated family phase, and the project links that record them.
 */
import { and, eq } from "drizzle-orm"

import { projectExternalLinks } from "@/db/schema"
import type { FamilyAdminContext } from "@/lib/domain/families/access"
import {
  driveFolderUrl,
  phaseTrackerInput,
  projectFamilyDepartment,
  quotedSheetRange,
} from "@/lib/domain/families/rules"
import { insertProjectExternalLink, updateProjectExternalLinks } from "@/lib/domain/project/store"
import type { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  buildDepartmentTrackerRow,
  buildProjectRegistryRow,
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  projectRowNumber,
  PROJECT_REGISTRY_DESTINATION,
  type ProjectTrackerLayout,
} from "@/lib/google/project-intake-tracker"
import { projectWorkspaceClients } from "@/lib/google/project-workspace"
import type { Db } from "@/lib/server/action-context"

export type PhaseTrackerWrite = {
  readonly updatedRange: string | null
  readonly alreadyPresent: boolean
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

export async function syncPhaseTrackerRows(input: {
  readonly context: FamilyAdminContext
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
  const folderUrl = input.project.googleDriveFolderId
    ? driveFolderUrl(input.project.googleDriveFolderId)
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
      driveFolderUrl: folderUrl,
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
      driveFolderUrl: folderUrl,
    }),
  })
  return { registry, department: departmentWrite }
}

export async function savePhaseTrackerLink(input: {
  readonly db: Db
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
    await updateProjectExternalLinks(input.db, eq(projectExternalLinks.id, existing.id), values)
    return
  }
  await insertProjectExternalLink(input.db, {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    system: input.system,
    createdAt: input.now,
    ...values,
  })
}
