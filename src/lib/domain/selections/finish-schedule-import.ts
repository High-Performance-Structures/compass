/**
 * Google Sheets finish-schedule import: load the workbook, preview it, and
 * reconcile its rooms and selections into the project. Writes go through the
 * selections store. Access is resolved by the caller.
 */
import { and, eq } from "drizzle-orm"

import { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { spreadsheetIdFromUrl } from "@/lib/financials/project-totals-import"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { parseFinishScheduleWorkbook } from "@/lib/selections/google-finish-schedule-import"
import type { Db, ProjectContext } from "@/lib/server/action-context"

import {
  importedSelectionIdentity,
  importedSourceChanged,
  matchImportedSelection,
  quotedSheetRange,
  type ImportedSelectionSourceValues,
  type LoadedFinishSchedule,
} from "./rules"
import {
  deleteRemovableSelections,
  insertFinishSelectionStatement,
  insertSelectionRoomStatement,
  updateFinishSelectionsStatement,
  updateSelectionRoomsStatement,
  type Statement,
} from "./store"

export type FinishScheduleImportAccess = {
  readonly db: Db
  readonly organizationId: string
  readonly projectNumber: string | null
  readonly googleEmail: string
  readonly client: SheetsClient
}

/** Adds the organization's Google Sheets client to a staff selections context. */
export async function finishScheduleImportAccess(
  context: ProjectContext & { readonly organizationId: string }
): Promise<FinishScheduleImportAccess> {
  const { db, organizationId, user, env } = context
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
    projectNumber: context.project.projectNumber,
    googleEmail: user.googleEmail ?? user.email,
    client: new SheetsClient(parseServiceAccountKey(keyJson))
  }
}

export async function loadFinishSchedule(
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
  // Sequential on purpose: Google Sheets API reads are rate limited.
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

async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

export type FinishScheduleImportCounts = {
  readonly createdCount: number
  readonly updatedCount: number
  readonly removedCount: number
  readonly conflictCount: number
  readonly staleCount: number
}

async function reconcileRooms(
  db: Db,
  projectId: string,
  loaded: LoadedFinishSchedule,
  now: string
): Promise<void> {
  const existingRooms = await db
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
  const statements: Statement[] = []
  for (const room of loaded.parsed.rooms) {
    const sourceSheetId = String(room.sheetId)
    const existing = roomsBySheetId.get(sourceSheetId)
    if (existing) {
      statements.push(
        updateSelectionRoomsStatement(db, eq(projectFinishSelectionRooms.id, existing.id), {
          sourceSheetName: room.sheetName,
          roomName: room.roomName,
          roomType: room.roomType,
          sortOrder: room.sortOrder,
          active: true,
          updatedAt: now
        })
      )
    } else {
      statements.push(
        insertSelectionRoomStatement(db, {
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
      )
    }
  }
  for (const staleRoom of existingRooms) {
    if (staleRoom.sourceSheetId !== null && importedSheetIds.has(staleRoom.sourceSheetId)) {
      continue
    }
    statements.push(
      updateSelectionRoomsStatement(db, eq(projectFinishSelectionRooms.id, staleRoom.id), {
        active: false,
        updatedAt: now
      })
    )
  }
  await runBatch(db, statements)
}

/**
 * Reconciles the workbook into the project: rooms first, then selections,
 * then removal of untouched rows the workbook no longer has. Each phase is
 * one batch, in the same statement order the per-row writes used.
 */
export async function applyFinishScheduleImport(
  db: Db,
  projectId: string,
  loaded: LoadedFinishSchedule
): Promise<FinishScheduleImportCounts> {
  const now = new Date().toISOString()
  await reconcileRooms(db, projectId, loaded, now)

  const existingSelections = await db
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
  const statements: Statement[] = []
  let createdCount = 0
  let updatedCount = 0
  let conflictCount = 0

  for (const selection of loaded.parsed.selections) {
    const sourceRecordId = `${loaded.workbookId}:${selection.sheetId}:${selection.sourceRowNumber}`
    const identity = importedSelectionIdentity({
      sourceSheetName: selection.sheetName,
      category: selection.category,
      name: selection.name
    })
    const existing = matchImportedSelection({
      identity,
      exactMatch: selectionsBySourceRecordId.get(sourceRecordId),
      identityMatches: selectionsByIdentity.get(identity) ?? [],
      usedSelectionIds,
      incomingIdentities: incomingSelectionIdentities
    })
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
      statements.push(
        insertFinishSelectionStatement(db, {
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
      )
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
    statements.push(
      updateFinishSelectionsStatement(db, eq(projectFinishSelections.id, existing.id), {
        ...sourceValues,
        sourceRecordId,
        status: approvalNeedsReview ? "owner_review" : existing.status,
        ownerApproved: approvalNeedsReview ? false : existing.ownerApproved,
        approvedBy: approvalNeedsReview ? null : existing.approvedBy,
        approvedAt: approvalNeedsReview ? null : existing.approvedAt,
        syncStatus: approvalNeedsReview ? "selection_change_review" : "imported"
      })
    )
    updatedCount += 1
    if (approvalNeedsReview) conflictCount += 1
  }
  await runBatch(db, statements)

  const staleSelections = existingSelections.filter(
    (selection) => !usedSelectionIds.has(selection.id)
  )
  const removableIds: string[] = []
  for (const stale of staleSelections) {
    const canRemoveUntouchedSourceRow =
      stale.syncStatus === "imported" && !stale.ownerApproved && stale.status === "needed"
    if (canRemoveUntouchedSourceRow) removableIds.push(stale.id)
    else conflictCount += 1
  }
  // The deletion guard is evaluated per row at delete time; a guarded row is a conflict.
  const removed = await deleteRemovableSelections(db, removableIds)
  const removedCount = removed.size
  conflictCount += removableIds.length - removedCount

  return {
    createdCount,
    updatedCount,
    removedCount,
    conflictCount,
    staleCount: staleSelections.length - removedCount
  }
}
