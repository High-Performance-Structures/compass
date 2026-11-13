"use server"

/*
 * Room edits on a job's finish schedule (Selections › Finish specs): add,
 * rename, delete, reorder and duplicate rooms, and duplicate or move one
 * selection. Staff with Finish Selections update permission; deleting a room
 * also needs delete permission. The rules live in room-edits.ts.
 */
import { revalidatePath } from "next/cache"

import { staffSelectionContext } from "@/lib/domain/selections/access"
import {
  addSelectionRoom,
  deleteSelectionRoom,
  duplicateSelection,
  duplicateSelectionRoom,
  moveSelectionToRoom,
  renameSelectionRoom,
  reorderSelectionRooms,
  type RoomEditResult,
} from "@/lib/domain/selections/room-edits"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

type ActionResult = { readonly success: true } | { readonly success: false; readonly error: string }

function revalidate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
}

async function run(
  projectId: string,
  edit: (db: Awaited<ReturnType<typeof staffSelectionContext>>["db"]) => Promise<RoomEditResult>,
  options: { readonly delete?: boolean } = {},
): Promise<ActionResult> {
  try {
    const { db, user } = await staffSelectionContext(projectId, "update")
    if (options.delete) await requireFeaturePermission(user, "finish-selections", "delete")
    const result = await edit(db)
    if (!result.ok) return { success: false, error: result.error }
    revalidate(projectId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The room could not be changed." }
  }
}

export async function addProjectSelectionRoom(projectId: string, input: { readonly roomName: string; readonly roomType: string }): Promise<ActionResult> {
  return run(projectId, (db) => addSelectionRoom(db, projectId, input))
}

export async function renameProjectSelectionRoom(
  projectId: string,
  input: { readonly fromName: string; readonly roomName: string; readonly roomType: string },
): Promise<ActionResult> {
  return run(projectId, (db) => renameSelectionRoom(db, projectId, input))
}

export async function deleteProjectSelectionRoom(projectId: string, roomName: string): Promise<ActionResult> {
  return run(projectId, (db) => deleteSelectionRoom(db, projectId, roomName), { delete: true })
}

export async function reorderProjectSelectionRooms(projectId: string, roomNames: readonly string[]): Promise<ActionResult> {
  return run(projectId, (db) => reorderSelectionRooms(db, projectId, roomNames))
}

export async function duplicateProjectSelectionRoom(
  projectId: string,
  input: { readonly fromName: string; readonly roomName: string; readonly roomType: string },
): Promise<ActionResult> {
  return run(projectId, (db) => duplicateSelectionRoom(db, projectId, input))
}

export async function duplicateProjectSelection(projectId: string, selectionId: string): Promise<ActionResult> {
  return run(projectId, (db) => duplicateSelection(db, projectId, selectionId))
}

export async function moveProjectSelectionToRoom(
  projectId: string,
  input: { readonly selectionId: string; readonly roomName: string },
): Promise<ActionResult> {
  return run(projectId, (db) => moveSelectionToRoom(db, projectId, input))
}
