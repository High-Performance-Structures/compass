/**
 * The Developer Project Registry and department Tracker sheets that project
 * intake reads (for numbering) and writes (one row per new project).
 */
import { eq } from "drizzle-orm"

import { projectExternalLinks } from "@/db/schema"
import type { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  buildDepartmentTrackerRow,
  buildProjectRegistryRow,
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  PROJECT_REGISTRY_DESTINATION,
  projectRowNumber,
  type ProjectIntakeDepartment,
  type ProjectIntakeTrackerInput,
  type ProjectTrackerLayout,
  type ProjectTrackingDestination,
} from "@/lib/google/project-intake-tracker"
import type { Db } from "@/lib/server/action-context"

import type { CreateProjectIntakeInput } from "./intake-types"
import { appendWarning } from "./rules"
import { updateProjectExternalLinksStatement, type Statement } from "./store"

type SheetRows = ReadonlyArray<ReadonlyArray<unknown>>

function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${range}`
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

type IntakeTrackerSheets = {
  readonly departmentDestination: ProjectTrackingDestination
  readonly registryRows: SheetRows
  readonly departmentRows: SheetRows
  readonly registryLayout: ProjectTrackerLayout | null
  readonly departmentLayout: ProjectTrackerLayout | null
}

/** Reads the registry and the department tracker together. */
export async function readIntakeTrackerSheets(input: {
  readonly sheets: SheetsClient
  readonly googleEmail: string
  readonly department: ProjectIntakeDepartment
}): Promise<IntakeTrackerSheets> {
  const departmentDestination = departmentTrackingDestination(input.department)
  const [registryRows, departmentRows] = await Promise.all([
    input.sheets.getValues(input.googleEmail, {
      spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      range: quotedSheetRange(PROJECT_REGISTRY_DESTINATION.sheetTitle, "A:Z"),
    }),
    input.sheets.getValues(input.googleEmail, {
      spreadsheetId: departmentDestination.spreadsheetId,
      range: quotedSheetRange(departmentDestination.sheetTitle, "A:AZ"),
    }),
  ])
  return {
    departmentDestination,
    registryRows,
    departmentRows,
    registryLayout: locateProjectTrackerLayout(registryRows),
    departmentLayout: locateProjectTrackerLayout(departmentRows),
  }
}

type TrackerRowWrite = { readonly updatedRange: string; readonly alreadyPresent: boolean }

/** Appends the project's row unless a row with its number is already there. */
async function appendProjectRowIfMissing(input: {
  readonly sheets: SheetsClient
  readonly googleEmail: string
  readonly spreadsheetId: string
  readonly sheetTitle: string
  readonly rows: SheetRows
  readonly layout: ProjectTrackerLayout
  readonly projectNumber: string
  readonly row: readonly string[]
}): Promise<TrackerRowWrite> {
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

/**
 * Writes the registry row, then the department tracker row. A failed write
 * leaves its receipt pending and adds a warning; the project is already safe.
 */
async function writeIntakeTrackerSheetRows(input: {
  readonly sheets: SheetsClient
  readonly googleEmail: string
  readonly trackers: IntakeTrackerSheets
  readonly registryLayout: ProjectTrackerLayout
  readonly departmentLayout: ProjectTrackerLayout
  readonly registryRow: readonly string[]
  readonly departmentRow: readonly string[]
  readonly projectNumber: string
  readonly warning: string | null
}): Promise<{
  readonly registryWrite: TrackerRowWrite | null
  readonly departmentWrite: TrackerRowWrite | null
  readonly warning: string | null
}> {
  const { trackers, projectNumber } = input
  const { departmentDestination } = trackers
  let warning = input.warning
  let registryWrite: TrackerRowWrite | null = null
  let departmentWrite: TrackerRowWrite | null = null
  try {
    registryWrite = await appendProjectRowIfMissing({
      sheets: input.sheets,
      googleEmail: input.googleEmail,
      spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      sheetTitle: PROJECT_REGISTRY_DESTINATION.sheetTitle,
      rows: trackers.registryRows,
      layout: input.registryLayout,
      projectNumber,
      row: input.registryRow,
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
      sheets: input.sheets,
      googleEmail: input.googleEmail,
      spreadsheetId: departmentDestination.spreadsheetId,
      sheetTitle: departmentDestination.sheetTitle,
      rows: trackers.departmentRows,
      layout: input.departmentLayout,
      projectNumber,
      row: input.departmentRow,
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
  return { registryWrite, departmentWrite, warning }
}

/** The registry and department tracker link receipts, in that order. */
function trackerReceiptStatements(
  db: Db,
  input: {
    readonly registryLinkId: string
    readonly departmentTrackerLinkId: string
    readonly departmentDestination: ProjectTrackingDestination
    readonly department: ProjectIntakeDepartment
    readonly registryWrite: TrackerRowWrite | null
    readonly departmentWrite: TrackerRowWrite | null
    readonly syncedAt: string
  },
): readonly [Statement, Statement] {
  const { registryWrite, departmentWrite, syncedAt } = input
  return [
    updateProjectExternalLinksStatement(db, eq(projectExternalLinks.id, input.registryLinkId), {
      syncStatus: registryWrite ? "mapped" : "pending",
      lastSyncedAt: registryWrite ? syncedAt : null,
      metadata: JSON.stringify({
        sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
        updatedRange: registryWrite?.updatedRange ?? null,
        alreadyPresent: registryWrite?.alreadyPresent ?? false,
      }),
      updatedAt: syncedAt,
    }),
    updateProjectExternalLinksStatement(db, eq(projectExternalLinks.id, input.departmentTrackerLinkId), {
      syncStatus: departmentWrite ? "mapped" : "pending",
      lastSyncedAt: departmentWrite ? syncedAt : null,
      metadata: JSON.stringify({
        sheet: input.departmentDestination.sheetTitle,
        department: input.department,
        updatedRange: departmentWrite?.updatedRange ?? null,
        alreadyPresent: departmentWrite?.alreadyPresent ?? false,
      }),
      updatedAt: syncedAt,
    }),
  ]
}

/**
 * The registry and department tracker rows for a new project. Intake creates
 * an assignment; existing directory client details remain canonical.
 */
export function intakeTrackerRowValues(input: {
  readonly registryLayout: ProjectTrackerLayout
  readonly departmentLayout: ProjectTrackerLayout
  readonly departmentDestination: ProjectTrackingDestination
  readonly intake: CreateProjectIntakeInput
  readonly department: ProjectIntakeDepartment
  readonly projectName: string
  readonly intakeDate: string
  readonly customerValues: {
    readonly name: string
    readonly company: string | null
    readonly email: string | null
    readonly phone: string | null
  }
  readonly projectNumber: string
  readonly driveFolderUrl: string | null
  readonly createdBy: string
}): { readonly registryRow: readonly string[]; readonly departmentRow: readonly string[] } {
  const { customerValues, projectNumber } = input
  const trackerProject: ProjectIntakeTrackerInput = {
    ...input.intake,
    department: input.department,
    projectName: input.projectName,
    intakeDate: input.intakeDate,
    clientName: customerValues.name,
    companyName: customerValues.company,
    contactEmail: customerValues.email,
    contactPhone: customerValues.phone,
  }
  return {
    registryRow: buildProjectRegistryRow({
      layout: input.registryLayout,
      project: trackerProject,
      projectNumber,
      driveFolderUrl: input.driveFolderUrl,
      departmentTrackerUrl: spreadsheetUrl(input.departmentDestination.spreadsheetId),
      createdBy: input.createdBy,
    }),
    departmentRow: buildDepartmentTrackerRow({
      layout: input.departmentLayout,
      project: trackerProject,
      projectNumber,
      driveFolderUrl: input.driveFolderUrl,
    }),
  }
}

/**
 * Writes the tracker rows, then saves the two link receipts and the caller's
 * tracker-operation receipt in one batch. Receipt failures only warn.
 */
export async function writeIntakeTrackers(
  db: Db,
  input: {
    readonly sheets: SheetsClient
    readonly googleEmail: string
    readonly trackers: IntakeTrackerSheets
    readonly registryRow: readonly string[]
    readonly departmentRow: readonly string[]
    readonly projectNumber: string
    readonly registryLayout: ProjectTrackerLayout
    readonly departmentLayout: ProjectTrackerLayout
    readonly department: ProjectIntakeDepartment
    readonly registryLinkId: string
    readonly departmentTrackerLinkId: string
    readonly warning: string | null
    readonly operationReceipt: (trackerStatus: "written" | "pending", syncedAt: string) => Statement
  },
): Promise<{ readonly trackerStatus: "written" | "pending"; readonly warning: string | null }> {
  const { departmentDestination } = input.trackers
  const rows = await writeIntakeTrackerSheetRows(input)
  const { registryWrite, departmentWrite } = rows
  let warning = rows.warning
  const trackerStatus: "written" | "pending" =
    registryWrite && departmentWrite ? "written" : "pending"
  const trackingSyncedAt = new Date().toISOString()
  try {
    await db.batch([
      ...trackerReceiptStatements(db, {
        registryLinkId: input.registryLinkId,
        departmentTrackerLinkId: input.departmentTrackerLinkId,
        departmentDestination,
        department: input.department,
        registryWrite,
        departmentWrite,
        syncedAt: trackingSyncedAt,
      }),
      input.operationReceipt(trackerStatus, trackingSyncedAt),
    ])
  } catch (error) {
    warning = appendWarning(
      warning,
      "Google tracking rows were handled, but Compass could not save every sync receipt. Reconcile by project number; do not resend the intake."
    )
    console.error("Unable to save Developer tracker receipts", error)
  }
  return { trackerStatus, warning }
}
