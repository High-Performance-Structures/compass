"use server"

import { selectionDeletionAllowed } from "@/lib/selections/deletion"

import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContacts,
  projectFinishSelectionRooms,
  projectFinishSelections,
  projectOperations,
  projects,
  sageCostCodes
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import {
  projectTemplateContentItems,
  projectTemplates,
  projectTemplateVersions
} from "@/db/schema-templates"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { spreadsheetIdFromUrl } from "@/lib/financials/project-totals-import"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  normalizeProjectNumber,
  parseFinishScheduleWorkbook,
  type ParsedFinishSchedule
} from "@/lib/selections/google-finish-schedule-import"
import { buildProjectTemplateContentApplication } from "@/lib/templates/project-template-content-application"
import { parseTemplateChoiceOptions } from "@/lib/templates/template-creation-import"

export type ProjectSelectionStatus =
  | "needed"
  | "proposed"
  | "owner_review"
  | "approved"
  | "pricing"
  | "rfq_sent"
  | "ordered"
  | "installed"
  | "unavailable"
  | "deferred"

export type ProjectSelectionItem = {
  readonly id: string
  readonly projectId: string
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceWorkbookId: string | null
  readonly sourceSheetName: string | null
  readonly roomName: string
  readonly roomType: string | null
  readonly category: string
  readonly name: string
  readonly description: string | null
  readonly quantity: number | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly choiceOptions: readonly string[]
  readonly parentSelectionId: string | null
  readonly parentChoiceValue: string | null
  readonly selectionLevel: number
  readonly supplierName: string | null
  readonly productUrl: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly status: ProjectSelectionStatus
  readonly ownerVisible: boolean
  readonly ownerApproved: boolean
  readonly rfqOperationId: string | null
  readonly purchaseOrderOperationId: string | null
  readonly notes: string | null
  readonly syncStatus: string
  readonly updatedAt: string
}

export type ProjectSelectionRoom = {
  readonly id: string
  readonly projectId: string
  readonly sourceSystem: string
  readonly sourceWorkbookId: string | null
  readonly sourceSheetId: string | null
  readonly sourceSheetName: string | null
  readonly roomName: string
  readonly roomType: string | null
  readonly sortOrder: number
  readonly selectionCount: number
  readonly selections: readonly ProjectSelectionItem[]
}

export type ProjectSelectionsSummary = {
  readonly totalCount: number
  readonly roomCount: number
  readonly sourceWorkbookCount: number
  readonly needsDecisionCount: number
  readonly approvedCount: number
  readonly pricingCount: number
  readonly orderedCount: number
  readonly rooms: readonly ProjectSelectionRoom[]
}

export type ProjectSelectionOption = {
  readonly value: string
  readonly label: string
}

export type ProjectSelectionCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionLabel: string
  readonly source: "sage" | "project_budget" | "selection"
  readonly needsSageReview: boolean
}

export type ProjectSelectionOptions = {
  readonly roomTypes: readonly ProjectSelectionOption[]
  readonly manufacturers: readonly ProjectSelectionOption[]
  readonly divisions: readonly ProjectSelectionOption[]
  readonly costCodes: readonly ProjectSelectionCostCodeOption[]
}

export type CreateProjectSelectionInput = {
  readonly roomName: string | null
  readonly roomType: string | null
  readonly category: string | null
  readonly name: string | null
  readonly description: string | null
  readonly quantity: string | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly supplierName: string | null
  readonly productUrl: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly status: string | null
  readonly notes: string | null
  readonly templateId?: string | null
  readonly templateContentItemId?: string | null
  readonly choiceOptions?: readonly string[]
}

export type UpdateProjectSelectionInput = CreateProjectSelectionInput & {
  readonly changeReason: string | null
}

type ActionResult =
  | { readonly success: true; readonly id?: string }
  | { readonly success: false; readonly error: string }

export type ProjectFinishScheduleImportPreview = {
  readonly workbookId: string
  readonly workbookTitle: string
  readonly workbookProjectNumber: string | null
  readonly compassProjectNumber: string | null
  readonly projectMatch: "match" | "mismatch" | "unknown"
  readonly roomCount: number
  readonly selectionCount: number
  readonly warnings: readonly string[]
}

export type ProjectFinishScheduleImportResult =
  | {
      readonly success: true
      readonly preview: ProjectFinishScheduleImportPreview
    }
  | { readonly success: false; readonly error: string }

export type ApplyProjectFinishScheduleImportResult =
  | {
      readonly success: true
      readonly createdCount: number
      readonly updatedCount: number
      readonly removedCount: number
      readonly conflictCount: number
      readonly staleCount: number
      readonly roomCount: number
    }
  | { readonly success: false; readonly error: string }

const PROJECT_SELECTION_STATUSES: readonly ProjectSelectionStatus[] = [
  "needed",
  "proposed",
  "owner_review",
  "approved",
  "pricing",
  "rfq_sent",
  "ordered",
  "installed",
  "unavailable",
  "deferred"
]

const ROOM_TYPE_OPTIONS: readonly string[] = [
  "Living Area",
  "Kitchen",
  "Dining",
  "Bedroom",
  "Bathroom",
  "Powder Room",
  "Laundry",
  "Mudroom",
  "Pantry",
  "Closet",
  "Office / Study",
  "Library",
  "Loft",
  "Rec Room",
  "Theater Room",
  "Wine Room",
  "Exercise Room",
  "Guest Suite",
  "Bunk Room",
  "Mechanical / Utility",
  "Garage",
  "Exterior",
  "Porch / Deck",
  "Hardscape",
  "Pool / Spa",
  "Sauna / Wellness",
  "Outdoor Kitchen",
  "Other"
]

const MANUFACTURER_OPTIONS: readonly string[] = [
  "Kohler",
  "Delta",
  "Moen",
  "Hansgrohe",
  "Brizo",
  "Rohl",
  "Schlage",
  "Kwikset",
  "Emtek",
  "Sherwin-Williams",
  "Benjamin Moore",
  "Daltile",
  "Marazzi",
  "Shaw",
  "Mohawk",
  "Bruce Hardwood",
  "Andersen Windows",
  "Marvin Windows",
  "James Hardie",
  "Custom (see notes)"
]

const EXCLUDED_SELECTION_COST_DIVISIONS = new Set(["00", "01", "02"])

async function verifyProjectAccess(
  projectId: string,
  permission: "read" | "update"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "finish-selections", permission)
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

type FinishScheduleImportAccess = {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectNumber: string | null
  readonly googleEmail: string
  readonly client: SheetsClient
}

async function finishScheduleImportAccess(projectId: string): Promise<FinishScheduleImportAccess> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "finish-selections", "update")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  const project = projectRows[0]
  if (!project) throw new Error("Project not found")

  const authRows = await db
    .select()
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, organizationId))
    .limit(1)
  const auth = authRows[0]
  if (!auth) throw new Error("Google Workspace service account is not connected.")

  const config = getGoogleConfig(env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  return {
    db,
    organizationId,
    projectNumber: project.projectNumber,
    googleEmail: user.googleEmail ?? user.email,
    client: new SheetsClient(parseServiceAccountKey(keyJson))
  }
}

type LoadedFinishSchedule = {
  readonly workbookId: string
  readonly workbookTitle: string
  readonly parsed: ParsedFinishSchedule
}

function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${range}`
}

async function loadFinishSchedule(
  access: FinishScheduleImportAccess,
  workbookUrl: string
): Promise<LoadedFinishSchedule> {
  const workbookId = spreadsheetIdFromUrl(workbookUrl)
  if (!workbookId) throw new Error("Enter a valid Google Sheets workbook URL.")
  const metadata = await access.client.getSpreadsheetMetadata(access.googleEmail, workbookId)
  const coverSheet = metadata.sheets.find(
    (sheet) => sheet.title.trim().toLowerCase() === "cover page"
  )
  const roomMetadata = metadata.sheets.filter((sheet) => {
    const title = sheet.title.trim().toLowerCase()
    return !sheet.hidden && title !== "cover page" && title !== "_validation"
  })
  const coverPageRows = coverSheet
    ? await access.client.getValues(access.googleEmail, {
        spreadsheetId: workbookId,
        range: quotedSheetRange(coverSheet.title, "A:K"),
        valueRenderOption: "UNFORMATTED_VALUE"
      })
    : []
  const roomSheets = []
  for (const sheet of roomMetadata) {
    const values = await access.client.getValues(access.googleEmail, {
      spreadsheetId: workbookId,
      range: quotedSheetRange(sheet.title, "A:G"),
      valueRenderOption: "UNFORMATTED_VALUE"
    })
    roomSheets.push({
      sheetId: sheet.sheetId,
      title: sheet.title,
      index: sheet.index,
      values
    })
  }

  return {
    workbookId,
    workbookTitle: metadata.title,
    parsed: parseFinishScheduleWorkbook({ coverPageRows, roomSheets })
  }
}

function finishSchedulePreview(
  loaded: LoadedFinishSchedule,
  compassProjectNumber: string | null
): ProjectFinishScheduleImportPreview {
  const workbookProjectNumber = loaded.parsed.projectNumber
  const normalizedWorkbook = normalizeProjectNumber(workbookProjectNumber)
  const normalizedCompass = normalizeProjectNumber(compassProjectNumber)
  const projectMatch =
    !normalizedWorkbook || !normalizedCompass
      ? "unknown"
      : normalizedWorkbook === normalizedCompass
        ? "match"
        : "mismatch"
  const warnings = [...loaded.parsed.warnings]
  if (projectMatch === "mismatch") {
    warnings.push(
      `Workbook project ${workbookProjectNumber ?? "unknown"} does not match Compass project ${compassProjectNumber ?? "unknown"}.`
    )
  }
  if (projectMatch === "unknown") {
    warnings.push("The workbook and Compass project numbers could not both be verified.")
  }
  return {
    workbookId: loaded.workbookId,
    workbookTitle: loaded.workbookTitle,
    workbookProjectNumber,
    compassProjectNumber,
    projectMatch,
    roomCount: loaded.parsed.rooms.length,
    selectionCount: loaded.parsed.selections.length,
    warnings
  }
}

type ImportedSelectionSourceValues = {
  readonly sourceSheetName: string
  readonly roomName: string
  readonly roomType: string | null
  readonly category: string
  readonly name: string
  readonly description: string | null
  readonly quantity: number | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly notes: string | null
  readonly sortOrder: number
  readonly lastSyncedAt: string
  readonly updatedAt: string
}

function importedSelectionIdentity(input: {
  readonly sourceSheetName: string | null
  readonly category: string
  readonly name: string
}): string {
  return [input.sourceSheetName ?? "", input.category, input.name]
    .map((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
    )
    .join("|")
}

function importedSourceChanged(
  existing: typeof projectFinishSelections.$inferSelect,
  incoming: ImportedSelectionSourceValues
): boolean {
  return (
    existing.roomName !== incoming.roomName ||
    existing.roomType !== incoming.roomType ||
    existing.category !== incoming.category ||
    existing.name !== incoming.name ||
    existing.description !== incoming.description ||
    existing.quantity !== incoming.quantity ||
    existing.manufacturer !== incoming.manufacturer ||
    existing.model !== incoming.model ||
    existing.colorFinish !== incoming.colorFinish ||
    existing.notes !== incoming.notes
  )
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  return cleaned
}

function isSelectionStatus(value: string): value is ProjectSelectionStatus {
  return PROJECT_SELECTION_STATUSES.some((status) => status === value)
}

function normalizeStatus(value: string | null): ProjectSelectionStatus {
  const cleaned = cleanText(value)
  if (cleaned && isSelectionStatus(cleaned)) return cleaned
  return "needed"
}

function parseQuantity(value: string | null): number | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Quantity must be a positive number.")
  }
  return parsed
}

function normalizedChoiceOptions(values: readonly string[] | undefined): readonly string[] {
  if (!values) return []
  const unique = new Set<string>()
  for (const value of values) {
    const cleaned = value.trim()
    if (!cleaned) continue
    if (cleaned.length > 200) {
      throw new Error("Template selection choices must be 200 characters or less.")
    }
    unique.add(cleaned)
  }
  if (unique.size > 200) {
    throw new Error("A finish selection may have no more than 200 choices.")
  }
  return [...unique]
}

type PublishedTemplateSelection = {
  readonly templateId: string
  readonly templateContentItemId: string
  readonly choiceOptions: readonly string[]
}

async function loadPublishedTemplateSelection(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  templateId: string,
  templateContentItemId: string
): Promise<PublishedTemplateSelection | null> {
  const matches = await db
    .select({
      templateId: projectTemplates.id,
      versionId: projectTemplateVersions.id,
      templateContentItemId: projectTemplateContentItems.id
    })
    .from(projectTemplateContentItems)
    .innerJoin(
      projectTemplateVersions,
      eq(projectTemplateVersions.id, projectTemplateContentItems.versionId)
    )
    .innerJoin(projectTemplates, eq(projectTemplates.id, projectTemplateVersions.templateId))
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified"),
        eq(projectTemplateVersions.status, "published"),
        eq(projectTemplateVersions.versionNumber, projectTemplates.currentVersionNumber),
        eq(projectTemplateContentItems.id, templateContentItemId),
        eq(projectTemplateContentItems.moduleType, "selections")
      )
    )
    .limit(1)
  const match = matches[0]
  if (!match) return null

  const versionItems = await db
    .select()
    .from(projectTemplateContentItems)
    .where(
      and(
        eq(projectTemplateContentItems.versionId, match.versionId),
        eq(projectTemplateContentItems.moduleType, "selections")
      )
    )
    .orderBy(asc(projectTemplateContentItems.sortOrder))
  let nextId = 0
  const build = buildProjectTemplateContentApplication({
    applicationId: `selection-create:${templateContentItemId}`,
    items: versionItems,
    nextId: () => `selection-create:${nextId++}`
  })
  const selection = build.selections.find(
    (candidate) => candidate.templateContentItemId === templateContentItemId
  )
  if (!selection) return null

  return {
    templateId: match.templateId,
    templateContentItemId: match.templateContentItemId,
    choiceOptions: parseTemplateChoiceOptions(selection.choiceOptionsJson)
  }
}

function normalizedNumberText(value: number | null): string {
  return value === null ? "" : String(value)
}

function normalizedText(value: string | null): string {
  return value?.trim() ?? ""
}

function changedTextField(
  label: string,
  before: string | null,
  after: string | null
): {
  readonly field: string
  readonly before: string
  readonly after: string
} | null {
  const normalizedBefore = normalizedText(before)
  const normalizedAfter = normalizedText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

function changedNumberField(
  label: string,
  before: number | null,
  after: number | null
): {
  readonly field: string
  readonly before: string
  readonly after: string
} | null {
  const normalizedBefore = normalizedNumberText(before)
  const normalizedAfter = normalizedNumberText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

function parseChoiceOptions(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (option): option is string => typeof option === "string" && option.trim().length > 0
    )
  } catch {
    return []
  }
}

function toSelectionItem(row: typeof projectFinishSelections.$inferSelect): ProjectSelectionItem {
  const status = isSelectionStatus(row.status) ? row.status : "needed"
  return {
    id: row.id,
    projectId: row.projectId,
    sourceSystem: row.sourceSystem,
    sourceRecordId: row.sourceRecordId,
    sourceWorkbookId: row.sourceWorkbookId,
    sourceSheetName: row.sourceSheetName,
    roomName: row.roomName,
    roomType: row.roomType,
    category: row.category,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    manufacturer: row.manufacturer,
    model: row.model,
    colorFinish: row.colorFinish,
    choiceOptions: parseChoiceOptions(row.choiceOptionsJson),
    parentSelectionId: row.parentSelectionId,
    parentChoiceValue: row.parentChoiceValue,
    selectionLevel: row.selectionLevel,
    supplierName: row.supplierName,
    productUrl: row.productUrl,
    costCode: row.costCode,
    phaseCode: row.phaseCode,
    status,
    ownerVisible: row.ownerVisible,
    ownerApproved: row.ownerApproved,
    rfqOperationId: row.rfqOperationId,
    purchaseOrderOperationId: row.purchaseOrderOperationId,
    notes: row.notes,
    syncStatus: row.syncStatus,
    updatedAt: row.updatedAt
  }
}

function summarizeSelections(
  roomRows: readonly (typeof projectFinishSelectionRooms.$inferSelect)[],
  selections: readonly ProjectSelectionItem[]
): ProjectSelectionsSummary {
  const roomMap = new Map<
    string,
    ProjectSelectionRoom & {
      readonly selections: ProjectSelectionItem[]
    }
  >()

  for (const room of roomRows) {
    roomMap.set(room.roomName, {
      id: room.id,
      projectId: room.projectId,
      sourceSystem: room.sourceSystem,
      sourceWorkbookId: room.sourceWorkbookId,
      sourceSheetId: room.sourceSheetId,
      sourceSheetName: room.sourceSheetName,
      roomName: room.roomName,
      roomType: room.roomType,
      sortOrder: room.sortOrder,
      selectionCount: 0,
      selections: []
    })
  }

  for (const selection of selections) {
    const existing = roomMap.get(selection.roomName)
    if (existing) {
      existing.selections.push(selection)
      continue
    }

    roomMap.set(selection.roomName, {
      id: `selection-room-${selection.roomName}`,
      projectId: selection.projectId,
      sourceSystem: selection.sourceSystem,
      sourceWorkbookId: selection.sourceWorkbookId,
      sourceSheetId: null,
      sourceSheetName: selection.sourceSheetName,
      roomName: selection.roomName,
      roomType: selection.roomType,
      sortOrder: roomMap.size + 1_000,
      selectionCount: 0,
      selections: [selection]
    })
  }

  const rooms = Array.from(roomMap.values())
    .map((room) => ({
      ...room,
      selectionCount: room.selections.length
    }))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }
      return left.roomName.localeCompare(right.roomName)
    })

  return {
    totalCount: selections.length,
    roomCount: rooms.length,
    sourceWorkbookCount: new Set(
      rooms.map((room) => room.sourceWorkbookId).filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) =>
      ["needed", "proposed", "owner_review", "unavailable"].includes(selection.status)
    ).length,
    approvedCount: selections.filter((selection) => selection.status === "approved").length,
    pricingCount: selections.filter((selection) =>
      ["pricing", "rfq_sent"].includes(selection.status)
    ).length,
    orderedCount: selections.filter((selection) =>
      ["ordered", "installed"].includes(selection.status)
    ).length,
    rooms
  }
}

export async function getProjectSelections(projectId: string): Promise<ProjectSelectionsSummary> {
  const db = await verifyProjectAccess(projectId, "read")
  const [roomRows, selectionRows] = await Promise.all([
    db
      .select()
      .from(projectFinishSelectionRooms)
      .where(
        and(
          eq(projectFinishSelectionRooms.projectId, projectId),
          eq(projectFinishSelectionRooms.active, true)
        )
      )
      .orderBy(
        asc(projectFinishSelectionRooms.sortOrder),
        asc(projectFinishSelectionRooms.roomName)
      ),
    db
      .select()
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId))
      .orderBy(
        asc(projectFinishSelections.roomName),
        asc(projectFinishSelections.category),
        asc(projectFinishSelections.sortOrder),
        asc(projectFinishSelections.name)
      )
  ])

  return summarizeSelections(roomRows, selectionRows.map(toSelectionItem))
}

export async function previewProjectFinishScheduleImport(
  projectId: string,
  workbookUrl: string
): Promise<ProjectFinishScheduleImportResult> {
  try {
    const access = await finishScheduleImportAccess(projectId)
    const loaded = await loadFinishSchedule(access, workbookUrl)
    return {
      success: true,
      preview: finishSchedulePreview(loaded, access.projectNumber)
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to preview the finish schedule workbook."
    }
  }
}

export async function importProjectFinishSchedule(
  projectId: string,
  workbookUrl: string
): Promise<ApplyProjectFinishScheduleImportResult> {
  try {
    const access = await finishScheduleImportAccess(projectId)
    const loaded = await loadFinishSchedule(access, workbookUrl)
    const preview = finishSchedulePreview(loaded, access.projectNumber)
    if (preview.projectMatch !== "match") {
      throw new Error(
        preview.projectMatch === "mismatch"
          ? `This workbook belongs to ${preview.workbookProjectNumber ?? "another project"}, not ${preview.compassProjectNumber ?? "this Compass project"}.`
          : "Add matching project numbers to the workbook and Compass before importing."
      )
    }
    if (loaded.parsed.selections.length === 0) {
      throw new Error("The workbook contains no finish selections to import.")
    }

    const now = new Date().toISOString()
    const existingRooms = await access.db
      .select()
      .from(projectFinishSelectionRooms)
      .where(
        and(
          eq(projectFinishSelectionRooms.projectId, projectId),
          eq(projectFinishSelectionRooms.sourceSystem, "google_sheets"),
          eq(projectFinishSelectionRooms.sourceWorkbookId, loaded.workbookId)
        )
      )
    const roomsBySheetId = new Map(
      existingRooms
        .filter((room) => room.sourceSheetId !== null)
        .map((room) => [room.sourceSheetId, room])
    )
    const importedSheetIds = new Set(loaded.parsed.rooms.map((room) => String(room.sheetId)))
    for (const room of loaded.parsed.rooms) {
      const sourceSheetId = String(room.sheetId)
      const existing = roomsBySheetId.get(sourceSheetId)
      if (existing) {
        await access.db
          .update(projectFinishSelectionRooms)
          .set({
            sourceSheetName: room.sheetName,
            roomName: room.roomName,
            roomType: room.roomType,
            sortOrder: room.sortOrder,
            active: true,
            updatedAt: now
          })
          .where(eq(projectFinishSelectionRooms.id, existing.id))
      } else {
        await access.db.insert(projectFinishSelectionRooms).values({
          id: crypto.randomUUID(),
          projectId,
          sourceSystem: "google_sheets",
          sourceWorkbookId: loaded.workbookId,
          sourceSheetId,
          sourceSheetName: room.sheetName,
          roomName: room.roomName,
          roomType: room.roomType,
          sortOrder: room.sortOrder,
          active: true,
          createdAt: now,
          updatedAt: now
        })
      }
    }
    for (const staleRoom of existingRooms) {
      if (staleRoom.sourceSheetId !== null && importedSheetIds.has(staleRoom.sourceSheetId)) {
        continue
      }
      await access.db
        .update(projectFinishSelectionRooms)
        .set({ active: false, updatedAt: now })
        .where(eq(projectFinishSelectionRooms.id, staleRoom.id))
    }

    const existingSelections = await access.db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.projectId, projectId),
          eq(projectFinishSelections.sourceSystem, "google_sheets"),
          eq(projectFinishSelections.sourceWorkbookId, loaded.workbookId)
        )
      )
    const selectionsBySourceRecordId = new Map(
      existingSelections
        .filter((selection) => selection.sourceRecordId !== null)
        .map((selection) => [selection.sourceRecordId, selection])
    )
    const selectionsByIdentity = new Map<string, (typeof projectFinishSelections.$inferSelect)[]>()
    for (const selection of existingSelections) {
      const identity = importedSelectionIdentity(selection)
      const matches = selectionsByIdentity.get(identity) ?? []
      matches.push(selection)
      selectionsByIdentity.set(identity, matches)
    }
    const incomingSelectionIdentities = new Set(
      loaded.parsed.selections.map((selection) =>
        importedSelectionIdentity({
          sourceSheetName: selection.sheetName,
          category: selection.category,
          name: selection.name
        })
      )
    )
    const usedSelectionIds = new Set<string>()
    let createdCount = 0
    let updatedCount = 0
    let removedCount = 0
    let conflictCount = 0

    for (const selection of loaded.parsed.selections) {
      const sourceRecordId = `${loaded.workbookId}:${selection.sheetId}:${selection.sourceRowNumber}`
      const identity = importedSelectionIdentity({
        sourceSheetName: selection.sheetName,
        category: selection.category,
        name: selection.name
      })
      const exactMatch = selectionsBySourceRecordId.get(sourceRecordId)
      const exactIdentity = exactMatch ? importedSelectionIdentity(exactMatch) : null
      const stableMatch = (selectionsByIdentity.get(identity) ?? []).find(
        (candidate) => !usedSelectionIds.has(candidate.id)
      )
      const unusedExactMatch =
        exactMatch && !usedSelectionIds.has(exactMatch.id) ? exactMatch : null
      // A semantic match at another row indicates an insertion/deletion/reorder.
      // If no such match exists and the old identity disappeared, this row was renamed in place.
      const existing =
        unusedExactMatch && exactIdentity === identity
          ? unusedExactMatch
          : (stableMatch ??
            (unusedExactMatch &&
            exactIdentity !== null &&
            !incomingSelectionIdentities.has(exactIdentity)
              ? unusedExactMatch
              : null))
      const sourceValues: ImportedSelectionSourceValues = {
        sourceSheetName: selection.sheetName,
        roomName: selection.roomName,
        roomType: selection.roomType,
        category: selection.category,
        name: selection.name,
        description: selection.description,
        quantity: selection.quantity,
        manufacturer: selection.manufacturer,
        model: selection.model,
        colorFinish: selection.colorFinish,
        notes: selection.notes,
        sortOrder: selection.sortOrder,
        lastSyncedAt: now,
        updatedAt: now
      }
      if (!existing) {
        await access.db.insert(projectFinishSelections).values({
          id: crypto.randomUUID(),
          projectId,
          sourceSystem: "google_sheets",
          sourceRecordId,
          sourceWorkbookId: loaded.workbookId,
          ...sourceValues,
          status: "needed",
          ownerVisible: false,
          ownerApproved: false,
          syncStatus: "imported",
          createdAt: now
        })
        createdCount += 1
        continue
      }
      usedSelectionIds.add(existing.id)
      if (existing.syncStatus !== "imported") {
        conflictCount += 1
        continue
      }
      const approvalNeedsReview =
        (existing.ownerApproved || existing.status === "approved") &&
        importedSourceChanged(existing, sourceValues)
      await access.db
        .update(projectFinishSelections)
        .set({
          ...sourceValues,
          sourceRecordId,
          status: approvalNeedsReview ? "owner_review" : existing.status,
          ownerApproved: approvalNeedsReview ? false : existing.ownerApproved,
          approvedBy: approvalNeedsReview ? null : existing.approvedBy,
          approvedAt: approvalNeedsReview ? null : existing.approvedAt,
          syncStatus: approvalNeedsReview ? "selection_change_review" : "imported"
        })
        .where(eq(projectFinishSelections.id, existing.id))
      updatedCount += 1
      if (approvalNeedsReview) conflictCount += 1
    }

    const staleSelections = existingSelections.filter(
      (selection) => !usedSelectionIds.has(selection.id)
    )
    for (const stale of staleSelections) {
      const canRemoveUntouchedSourceRow =
        stale.syncStatus === "imported" && !stale.ownerApproved && stale.status === "needed"
      if (!canRemoveUntouchedSourceRow) {
        conflictCount += 1
        continue
      }
      const removed = await access.db
        .delete(projectFinishSelections)
        .where(and(eq(projectFinishSelections.id, stale.id), selectionDeletionAllowed(stale.id)))
        .returning({ id: projectFinishSelections.id })
      removedCount += removed.length
      if (!removed.length) conflictCount += 1
    }
    const staleCount = staleSelections.length - removedCount

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return {
      success: true,
      createdCount,
      updatedCount,
      removedCount,
      conflictCount,
      staleCount,
      roomCount: loaded.parsed.rooms.length
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to import the finish schedule workbook."
    }
  }
}

function optionFromLabel(label: string): ProjectSelectionOption {
  return { value: label, label }
}

function uniqueSortedOptions(values: readonly string[]): ProjectSelectionOption[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map(optionFromLabel)
}

function divisionLabel(code: string, description: string): string {
  return code ? `${code} 00 00 ${description}` : description
}

function costCodeLabel(code: string, description: string): string {
  return code ? `${code} ${description}` : description
}

function divisionCodeFromCostCode(code: string): string {
  return code.trim().slice(0, 2)
}

function fallbackDivisionLabel(code: string): string {
  const divisionCode = divisionCodeFromCostCode(code)
  return divisionCode ? `${divisionCode} 00 00 Unmapped` : "Unmapped"
}

function fallbackCostCodeDescription(code: string): string {
  return code ? `CSI workbook cost code ${code}` : "CSI workbook cost code"
}

function projectTaskNumberFor(existingCount: number): string {
  return `TASK-${String(existingCount + 1).padStart(3, "0")}`
}

export async function getProjectSelectionOptions(
  projectId: string
): Promise<ProjectSelectionOptions> {
  const db = await verifyProjectAccess(projectId, "read")

  const [sageRows, budgetRows, contactRows, selectionRows] = await Promise.all([
    db
      .select({
        code: sageCostCodes.code,
        description: sageCostCodes.description,
        displayLabel: sageCostCodes.displayLabel,
        divisionCode: sageCostCodes.divisionCode,
        divisionDisplayLabel: sageCostCodes.divisionDisplayLabel
      })
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel)),
    db
      .select({
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        csiDivision: projectBudgetLines.csiDivision,
        csiDivisionName: projectBudgetLines.csiDivisionName
      })
      .from(projectBudgetLines)
      .leftJoin(
        projectBudgetApplications,
        eq(projectBudgetApplications.id, projectBudgetLines.applicationId)
      )
      .where(
        and(
          eq(projectBudgetLines.projectId, projectId),
          or(
            isNull(projectBudgetApplications.status),
            ne(projectBudgetApplications.status, "building")
          )
        )
      )
      .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.costCode)),
    db
      .select({
        companyName: projectContacts.companyName,
        displayName: projectContacts.displayName,
        contactType: projectContacts.contactType,
        csiDivision: projectContacts.csiDivision,
        csiDivisionName: projectContacts.csiDivisionName,
        primaryCostCode: projectContacts.primaryCostCode
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.companyName), asc(projectContacts.displayName)),
    db
      .select({
        manufacturer: projectFinishSelections.manufacturer,
        supplierName: projectFinishSelections.supplierName,
        costCode: projectFinishSelections.costCode,
        category: projectFinishSelections.category
      })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId))
  ])

  const divisionMap = new Map<string, ProjectSelectionOption>()
  const costCodeMap = new Map<string, ProjectSelectionCostCodeOption>()

  for (const row of sageRows) {
    if (EXCLUDED_SELECTION_COST_DIVISIONS.has(row.divisionCode)) continue

    if (row.divisionCode && row.divisionDisplayLabel) {
      divisionMap.set(row.divisionCode, {
        value: row.divisionCode,
        label: row.divisionDisplayLabel
      })
    }

    costCodeMap.set(row.code, {
      value: row.code,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode,
      divisionLabel: row.divisionDisplayLabel,
      source: "sage",
      needsSageReview: false
    })
  }

  for (const row of budgetRows) {
    if (EXCLUDED_SELECTION_COST_DIVISIONS.has(row.csiDivision)) continue

    if (row.csiDivision && row.csiDivisionName) {
      divisionMap.set(row.csiDivision, {
        value: row.csiDivision,
        label: divisionLabel(row.csiDivision, row.csiDivisionName)
      })
    }
    if (!costCodeMap.has(row.costCode)) {
      costCodeMap.set(row.costCode, {
        value: row.costCode,
        label: costCodeLabel(row.costCode, row.description),
        description: row.description,
        divisionCode: row.csiDivision,
        divisionLabel: divisionLabel(row.csiDivision, row.csiDivisionName),
        source: "project_budget",
        needsSageReview: true
      })
    }
  }

  for (const row of contactRows) {
    if (row.csiDivision && EXCLUDED_SELECTION_COST_DIVISIONS.has(row.csiDivision)) {
      continue
    }

    if (row.csiDivision && row.csiDivisionName) {
      divisionMap.set(row.csiDivision, {
        value: row.csiDivision,
        label: divisionLabel(row.csiDivision, row.csiDivisionName)
      })
    }
  }

  for (const row of selectionRows) {
    if (!row.costCode) continue
    const divisionCode = divisionCodeFromCostCode(row.costCode)
    if (EXCLUDED_SELECTION_COST_DIVISIONS.has(divisionCode)) continue
    const existingDivisionLabel =
      divisionMap.get(divisionCode)?.label ?? fallbackDivisionLabel(row.costCode)

    if (!divisionMap.has(divisionCode)) {
      divisionMap.set(divisionCode, {
        value: divisionCode,
        label: existingDivisionLabel
      })
    }

    if (!costCodeMap.has(row.costCode)) {
      const description = row.category
        ? `${row.category} selection`
        : fallbackCostCodeDescription(row.costCode)

      costCodeMap.set(row.costCode, {
        value: row.costCode,
        label: costCodeLabel(row.costCode, description),
        description,
        divisionCode,
        divisionLabel: existingDivisionLabel,
        source: "selection",
        needsSageReview: true
      })
    }
  }

  const manufacturerValues = [
    ...MANUFACTURER_OPTIONS,
    ...contactRows
      .filter((row) => row.contactType === "supplier")
      .flatMap((row) => [row.companyName, row.displayName]),
    ...selectionRows.flatMap((row) => [row.manufacturer, row.supplierName])
  ].filter((value): value is string => Boolean(value))

  return {
    roomTypes: ROOM_TYPE_OPTIONS.map(optionFromLabel),
    manufacturers: uniqueSortedOptions(manufacturerValues),
    divisions: Array.from(divisionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    )
  }
}

export async function requestSelectionCostCodeSageReview(
  projectId: string,
  costCode: string
): Promise<ActionResult> {
  try {
    const cleanedCostCode = requiredText(costCode, "Cost code")
    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()

    const [existing] = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "sage_cost_code_request"),
          eq(projectOperations.costCode, cleanedCostCode),
          eq(projectOperations.syncStatus, "needs_review")
        )
      )
      .limit(1)

    if (!existing) {
      const id = crypto.randomUUID()
      await db.insert(projectOperations).values({
        id,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "sage_cost_code_request",
        sourceRecordId: cleanedCostCode,
        sourceRecordNumber: cleanedCostCode,
        title: `Add Sage cost code ${cleanedCostCode}`,
        description:
          "Compass finish selections reference this CSI cost code, but it is not currently in the Sage cost code list.",
        status: "open",
        priority: "normal",
        costCode: cleanedCostCode,
        sageCostCode: cleanedCostCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify({
          source: "compass_finish_selection",
          requestedCostCode: cleanedCostCode
        }),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })
    }

    await db
      .update(projectFinishSelections)
      .set({
        syncStatus: "needs_sage_review",
        updatedAt: now
      })
      .where(
        and(
          eq(projectFinishSelections.projectId, projectId),
          eq(projectFinishSelections.costCode, cleanedCostCode)
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id: existing?.id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to request Sage cost code review"
    }
  }
}

export async function createProjectSelection(
  projectId: string,
  input: CreateProjectSelectionInput
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const roomName = requiredText(input.roomName, "Room")
    const roomType = cleanText(input.roomType)
    const templateId = cleanText(input.templateId ?? null)
    const templateContentItemId = cleanText(input.templateContentItemId ?? null)
    if (Boolean(templateId) !== Boolean(templateContentItemId)) {
      throw new Error("Choose both a template and one of its finish selections.")
    }
    const templateSelection =
      templateId && templateContentItemId
        ? await loadPublishedTemplateSelection(
            db,
            organizationId,
            templateId,
            templateContentItemId
          )
        : null
    if (templateId && templateContentItemId && !templateSelection) {
      throw new Error("That published template finish selection is no longer available.")
    }
    const choiceOptions = normalizedChoiceOptions(
      templateSelection?.choiceOptions ?? input.choiceOptions
    )

    await db
      .insert(projectFinishSelectionRooms)
      .values({
        id: `selection-room-${projectId}-${roomName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`,
        projectId,
        sourceSystem: "compass",
        roomName,
        roomType,
        sortOrder: 1_000,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()

    await db.insert(projectFinishSelections).values({
      id,
      projectId,
      sourceSystem: templateSelection ? "compass_template" : "compass",
      sourceRecordId: templateSelection
        ? `${templateSelection.templateId}:${templateSelection.templateContentItemId}`
        : null,
      roomName,
      roomType,
      category: cleanText(input.category) ?? "Uncategorized",
      name: requiredText(input.name, "Selection name"),
      description: cleanText(input.description),
      quantity: parseQuantity(input.quantity),
      manufacturer: cleanText(input.manufacturer),
      model: cleanText(input.model),
      colorFinish: cleanText(input.colorFinish),
      choiceOptionsJson: choiceOptions.length > 0 ? JSON.stringify(choiceOptions) : null,
      supplierName: cleanText(input.supplierName),
      productUrl: cleanText(input.productUrl),
      costCode: cleanText(input.costCode),
      phaseCode: cleanText(input.phaseCode),
      status: normalizeStatus(input.status),
      notes: cleanText(input.notes),
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now
    })

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create selection"
    }
  }
}

export async function updateProjectSelection(
  projectId: string,
  selectionId: string,
  input: UpdateProjectSelectionInput
): Promise<ActionResult> {
  try {
    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()
    const roomName = requiredText(input.roomName, "Room")
    const roomType = cleanText(input.roomType)
    const category = cleanText(input.category) ?? "Uncategorized"
    const name = requiredText(input.name, "Selection name")
    const description = cleanText(input.description)
    const quantity = parseQuantity(input.quantity)
    const manufacturer = cleanText(input.manufacturer)
    const model = cleanText(input.model)
    const colorFinish = cleanText(input.colorFinish)
    const supplierName = cleanText(input.supplierName)
    const productUrl = cleanText(input.productUrl)
    const costCode = cleanText(input.costCode)
    const phaseCode = cleanText(input.phaseCode)
    const status = normalizeStatus(input.status)
    const notes = cleanText(input.notes)
    const changeReason = cleanText(input.changeReason)

    const [existing] = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    const changes = [
      changedTextField("Room", existing.roomName, roomName),
      changedTextField("Room type", existing.roomType, roomType),
      changedTextField("Category", existing.category, category),
      changedTextField("Selection", existing.name, name),
      changedTextField("Description", existing.description, description),
      changedNumberField("Quantity", existing.quantity, quantity),
      changedTextField("Manufacturer", existing.manufacturer, manufacturer),
      changedTextField("Model", existing.model, model),
      changedTextField("Color / finish", existing.colorFinish, colorFinish),
      changedTextField("Supplier", existing.supplierName, supplierName),
      changedTextField("Product link", existing.productUrl, productUrl),
      changedTextField("Cost code", existing.costCode, costCode),
      changedTextField("Phase", existing.phaseCode, phaseCode),
      changedTextField("Status", existing.status, status),
      changedTextField("Notes", existing.notes, notes)
    ].filter((change) => change !== null)
    const specificationChanged = changes.some(change => change.field !== "Status" && change.field !== "Notes")

    await db
      .insert(projectFinishSelectionRooms)
      .values({
        id: `selection-room-${projectId}-${roomName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`,
        projectId,
        sourceSystem: "compass",
        roomName,
        roomType,
        sortOrder: 1_000,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()

    await db
      .update(projectFinishSelections)
      .set({
        roomName,
        roomType,
        category,
        name,
        description,
        quantity,
        manufacturer,
        model,
        colorFinish,
        supplierName,
        productUrl,
        costCode,
        phaseCode,
        status,
        // Staff workflow status is not an owner signature. Material edits invalidate it.
        ownerApproved: specificationChanged ? false : existing.ownerApproved,
        approvedBy: specificationChanged ? null : existing.approvedBy,
        approvedAt: specificationChanged ? null : existing.approvedAt,
        notes,
        syncStatus:
          existing.status === "approved" && changes.length > 0
            ? "selection_change_review"
            : existing.sourceSystem === "google_sheets" && changes.length > 0
              ? "manual_edit"
              : existing.syncStatus,
        updatedAt: now
      })
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )

    if (existing.status === "approved" && changes.length > 0) {
      const logId = crypto.randomUUID()
      const changeOrderReviewId = crypto.randomUUID()
      const pmTaskId = crypto.randomUUID()
      const adminTaskId = crypto.randomUUID()
      const [project] = await db
        .select({
          projectManager: projects.projectManager,
          sageJobId: projects.sageJobId,
          sageJobNumber: projects.sageJobNumber
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      const taskRows = await db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            inArray(projectOperations.sourceRecordType, [
              "staff_task",
              "subcontractor_task",
              "supplier_task",
              "schedule_task"
            ])
          )
        )
      const payload = {
        source: "compass_finish_selection",
        selectionId,
        selectionName: existing.name,
        changeReason,
        changes
      }

      await db.insert(projectOperations).values({
        id: logId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_change_log",
        sourceRecordId: selectionId,
        title: `Finish selection changed: ${existing.name}`,
        description:
          changeReason ??
          "Approved finish selection was edited and should be shared with affected subs/suppliers.",
        status: "open",
        priority: "normal",
        costCode,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await db.insert(projectOperations).values({
        id: changeOrderReviewId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_change_order_review",
        sourceRecordId: selectionId,
        title: `Review change order impact: ${existing.name}`,
        description:
          "Approved finish selection changed. Review contract phase, schedule cutoff, RFQs/POs, and whether an owner change order is required.",
        status: "open",
        priority: "high",
        costCode,
        sageCostCode: costCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })

      await db.insert(projectOperations).values({
        id: pmTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length),
        title: `Review approved selection change: ${existing.name}`,
        description:
          "Review the approved finish selection edit for schedule, RFQ, PO, and change-order impact.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: project?.projectManager ?? "Project Manager",
        costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_manager",
          linkedChangeOrderReviewId: changeOrderReviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await db.insert(projectOperations).values({
        id: adminTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length + 1),
        title: `Share selection change: ${existing.name}`,
        description:
          "Notify affected subs/suppliers and update any RFQ, PO, or jobsite finish schedule packet tied to this selection.",
        status: "open",
        priority: "normal",
        assigneeType: "internal",
        assigneeName: "Project Administrator",
        costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_administrator",
          linkedChangeLogId: logId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update selection"
    }
  }
}

export async function updateProjectSelectionStatus(
  projectId: string,
  selectionId: string,
  status: string
): Promise<ActionResult> {
  try {
    if (!isSelectionStatus(status)) {
      return { success: false, error: "Unsupported selection status." }
    }

    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()
    const [existing] = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    await db
      .update(projectFinishSelections)
      .set({
        status,
        // Only the authenticated owner decision action records owner approval.
        ownerApproved: existing.ownerApproved,
        approvedAt: existing.approvedAt,
        syncStatus:
          status === "unavailable" && existing.status !== "unavailable"
            ? "selection_change_review"
            : existing.syncStatus,
        updatedAt: now
      })
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )

    if (status === "unavailable" && existing.status !== "unavailable") {
      const reviewId = crypto.randomUUID()
      const pmTaskId = crypto.randomUUID()
      const adminTaskId = crypto.randomUUID()
      const [project] = await db
        .select({
          projectManager: projects.projectManager,
          sageJobId: projects.sageJobId,
          sageJobNumber: projects.sageJobNumber
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      const taskRows = await db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            inArray(projectOperations.sourceRecordType, [
              "staff_task",
              "subcontractor_task",
              "supplier_task",
              "schedule_task"
            ])
          )
        )
      const payload = {
        source: "compass_finish_selection",
        selectionId,
        selectionName: existing.name,
        previousStatus: existing.status,
        nextStatus: status,
        requiredFollowUp: [
          "Confirm product availability issue.",
          "Ask owner to select an alternate.",
          "Review RFQ, PO, schedule, and change-order impact."
        ]
      }

      await db.insert(projectOperations).values({
        id: reviewId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_unavailable_review",
        sourceRecordId: selectionId,
        title: `Selection unavailable: ${existing.name}`,
        description:
          "Selection was marked unavailable. Owner needs an alternate, and the team should review schedule, RFQ/PO, and change-order impact.",
        status: "open",
        priority: "high",
        costCode: existing.costCode,
        sageCostCode: existing.costCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })

      await db.insert(projectOperations).values({
        id: pmTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length),
        title: `Review unavailable selection: ${existing.name}`,
        description:
          "Confirm impact of the unavailable finish selection and determine whether a change order is required.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: project?.projectManager ?? "Project Manager",
        costCode: existing.costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: existing.costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_manager",
          linkedUnavailableReviewId: reviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await db.insert(projectOperations).values({
        id: adminTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length + 1),
        title: `Request alternate selection: ${existing.name}`,
        description:
          "Coordinate with the owner for an alternate selection and notify affected subs/suppliers once approved.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: "Project Administrator",
        costCode: existing.costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: existing.costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_administrator",
          linkedUnavailableReviewId: reviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update selection"
    }
  }
}

export async function deleteProjectSelection(
  projectId: string,
  selectionId: string
): Promise<ActionResult> {
  try {
    const db = await verifyProjectAccess(projectId, "update")
    await requireFeaturePermission(await requireAuth(), "finish-selections", "delete")
    const [existing] = await db
      .select({
        id: projectFinishSelections.id,
        status: projectFinishSelections.status,
        ownerApproved: projectFinishSelections.ownerApproved
      })
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    if (existing.ownerApproved || existing.status === "approved") {
      return {
        success: false,
        error:
          "Approved selections cannot be deleted. Change the selection status or create a change review instead."
      }
    }

    const deleted = await db
      .delete(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId),
          selectionDeletionAllowed(selectionId)
        )
      ).returning({id:projectFinishSelections.id})
    if (!deleted.length) return {success:false,error:"Unpublish the decision, close pending requests, and remove procurement links before deleting. Owner-approved decisions must be retained."}

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete selection"
    }
  }
}
