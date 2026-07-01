"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetLines,
  projectContacts,
  projectFinishSelectionRooms,
  projectFinishSelections,
  projectOperations,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"

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
}

export type UpdateProjectSelectionInput = CreateProjectSelectionInput & {
  readonly changeReason: string | null
}

type ActionResult =
  | { readonly success: true; readonly id?: string }
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
  "deferred",
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
  "Other",
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
  "Custom (see notes)",
]

const EXCLUDED_SELECTION_COST_DIVISIONS = new Set(["00", "01", "02"])

async function verifyProjectAccess(
  projectId: string,
  permission: "read" | "update"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "finish-selections", permission)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  await assertProjectAccess(db, user, projectId)
  return db
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
): { readonly field: string; readonly before: string; readonly after: string } | null {
  const normalizedBefore = normalizedText(before)
  const normalizedAfter = normalizedText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

function changedNumberField(
  label: string,
  before: number | null,
  after: number | null
): { readonly field: string; readonly before: string; readonly after: string } | null {
  const normalizedBefore = normalizedNumberText(before)
  const normalizedAfter = normalizedNumberText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

function toSelectionItem(
  row: typeof projectFinishSelections.$inferSelect
): ProjectSelectionItem {
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
    updatedAt: row.updatedAt,
  }
}

function summarizeSelections(
  roomRows: readonly (typeof projectFinishSelectionRooms.$inferSelect)[],
  selections: readonly ProjectSelectionItem[]
): ProjectSelectionsSummary {
  const roomMap = new Map<string, ProjectSelectionRoom & {
    readonly selections: ProjectSelectionItem[]
  }>()

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
      selections: [],
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
      selections: [selection],
    })
  }

  const rooms = Array.from(roomMap.values())
    .map((room) => ({
      ...room,
      selectionCount: room.selections.length,
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
      rooms
        .map((room) => room.sourceWorkbookId)
        .filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) =>
      ["needed", "proposed", "owner_review", "unavailable"].includes(
        selection.status
      )
    ).length,
    approvedCount: selections.filter((selection) => selection.status === "approved")
      .length,
    pricingCount: selections.filter((selection) =>
      ["pricing", "rfq_sent"].includes(selection.status)
    ).length,
    orderedCount: selections.filter((selection) =>
      ["ordered", "installed"].includes(selection.status)
    ).length,
    rooms,
  }
}

export async function getProjectSelections(
  projectId: string
): Promise<ProjectSelectionsSummary> {
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
      ),
  ])

  return summarizeSelections(roomRows, selectionRows.map(toSelectionItem))
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
        divisionDisplayLabel: sageCostCodes.divisionDisplayLabel,
      })
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel)),
    db
      .select({
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        csiDivision: projectBudgetLines.csiDivision,
        csiDivisionName: projectBudgetLines.csiDivisionName,
      })
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.projectId, projectId))
      .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.costCode)),
    db
      .select({
        companyName: projectContacts.companyName,
        displayName: projectContacts.displayName,
        contactType: projectContacts.contactType,
        csiDivision: projectContacts.csiDivision,
        csiDivisionName: projectContacts.csiDivisionName,
        primaryCostCode: projectContacts.primaryCostCode,
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.companyName), asc(projectContacts.displayName)),
    db
      .select({
        manufacturer: projectFinishSelections.manufacturer,
        supplierName: projectFinishSelections.supplierName,
        costCode: projectFinishSelections.costCode,
        category: projectFinishSelections.category,
      })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId)),
  ])

  const divisionMap = new Map<string, ProjectSelectionOption>()
  const costCodeMap = new Map<string, ProjectSelectionCostCodeOption>()

  for (const row of sageRows) {
    if (EXCLUDED_SELECTION_COST_DIVISIONS.has(row.divisionCode)) continue

    if (row.divisionCode && row.divisionDisplayLabel) {
      divisionMap.set(row.divisionCode, {
        value: row.divisionCode,
        label: row.divisionDisplayLabel,
      })
    }

    costCodeMap.set(row.code, {
      value: row.code,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode,
      divisionLabel: row.divisionDisplayLabel,
      source: "sage",
      needsSageReview: false,
    })
  }

  for (const row of budgetRows) {
    if (EXCLUDED_SELECTION_COST_DIVISIONS.has(row.csiDivision)) continue

    if (row.csiDivision && row.csiDivisionName) {
      divisionMap.set(row.csiDivision, {
        value: row.csiDivision,
        label: divisionLabel(row.csiDivision, row.csiDivisionName),
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
        needsSageReview: true,
      })
    }
  }

  for (const row of contactRows) {
    if (
      row.csiDivision &&
      EXCLUDED_SELECTION_COST_DIVISIONS.has(row.csiDivision)
    ) {
      continue
    }

    if (row.csiDivision && row.csiDivisionName) {
      divisionMap.set(row.csiDivision, {
        value: row.csiDivision,
        label: divisionLabel(row.csiDivision, row.csiDivisionName),
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
        label: existingDivisionLabel,
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
        needsSageReview: true,
      })
    }
  }

  const manufacturerValues = [
    ...MANUFACTURER_OPTIONS,
    ...contactRows
      .filter((row) => row.contactType === "supplier")
      .flatMap((row) => [row.companyName, row.displayName]),
    ...selectionRows.flatMap((row) => [row.manufacturer, row.supplierName]),
  ].filter((value): value is string => Boolean(value))

  return {
    roomTypes: ROOM_TYPE_OPTIONS.map(optionFromLabel),
    manufacturers: uniqueSortedOptions(manufacturerValues),
    divisions: Array.from(divisionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
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
          requestedCostCode: cleanedCostCode,
        }),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now,
      })
    }

    await db
      .update(projectFinishSelections)
      .set({
        syncStatus: "needs_sage_review",
        updatedAt: now,
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
      error:
        error instanceof Error
          ? error.message
          : "Failed to request Sage cost code review",
    }
  }
}

export async function createProjectSelection(
  projectId: string,
  input: CreateProjectSelectionInput
): Promise<ActionResult> {
  try {
    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const roomName = requiredText(input.roomName, "Room")
    const roomType = cleanText(input.roomType)

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
        updatedAt: now,
      })
      .onConflictDoNothing()

    await db.insert(projectFinishSelections).values({
      id,
      projectId,
      sourceSystem: "compass",
      roomName,
      roomType,
      category: cleanText(input.category) ?? "Uncategorized",
      name: requiredText(input.name, "Selection name"),
      description: cleanText(input.description),
      quantity: parseQuantity(input.quantity),
      manufacturer: cleanText(input.manufacturer),
      model: cleanText(input.model),
      colorFinish: cleanText(input.colorFinish),
      supplierName: cleanText(input.supplierName),
      productUrl: cleanText(input.productUrl),
      costCode: cleanText(input.costCode),
      phaseCode: cleanText(input.phaseCode),
      status: normalizeStatus(input.status),
      notes: cleanText(input.notes),
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create selection",
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
      changedTextField("Notes", existing.notes, notes),
    ].filter((change) => change !== null)

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
        updatedAt: now,
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
        ownerApproved: status === "approved",
        approvedAt: status === "approved" ? (existing.approvedAt ?? now) : null,
        notes,
        syncStatus:
          existing.status === "approved" && changes.length > 0
            ? "selection_change_review"
            : existing.syncStatus,
        updatedAt: now,
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
          sageJobNumber: projects.sageJobNumber,
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
              "schedule_task",
            ])
          )
        )
      const payload = {
        source: "compass_finish_selection",
        selectionId,
        selectionName: existing.name,
        changeReason,
        changes,
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
        updatedAt: now,
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
        updatedAt: now,
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
          linkedChangeOrderReviewId: changeOrderReviewId,
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now,
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
          linkedChangeLogId: logId,
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now,
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update selection",
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
        ownerApproved: status === "approved",
        approvedAt: status === "approved" ? now : null,
        syncStatus:
          status === "unavailable" && existing.status !== "unavailable"
            ? "selection_change_review"
            : existing.syncStatus,
        updatedAt: now,
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
          sageJobNumber: projects.sageJobNumber,
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
              "schedule_task",
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
          "Review RFQ, PO, schedule, and change-order impact.",
        ],
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
        updatedAt: now,
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
          linkedUnavailableReviewId: reviewId,
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now,
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
          linkedUnavailableReviewId: reviewId,
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now,
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update selection",
    }
  }
}

export async function deleteProjectSelection(
  projectId: string,
  selectionId: string
): Promise<ActionResult> {
  try {
    const db = await verifyProjectAccess(projectId, "update")
    const [existing] = await db
      .select({
        id: projectFinishSelections.id,
        status: projectFinishSelections.status,
        ownerApproved: projectFinishSelections.ownerApproved,
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
          "Approved selections cannot be deleted. Change the selection status or create a change review instead.",
      }
    }

    await db
      .delete(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete selection",
    }
  }
}
