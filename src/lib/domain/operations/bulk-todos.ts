import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod/v4"
import { projectOperations } from "@/db/schema"
import { errorMessage, type ActionResult } from "@/lib/action-result"
import { chunkD1Values } from "@/lib/d1-query"
import { canFeature } from "@/lib/permission-enforcement"
import { isArchivedProjectTodoStatus, PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { operationsContext } from "./access"
import { changeTodosReturning } from "./store"
import { revalidateProjectTodoPaths } from "./todo-commands"

const inputSchema = z.object({
  mode: z.enum(["archive", "restore", "delete"]),
  selection: z.array(z.object({ id: z.string().min(1), updatedAt: z.string().min(1) })).min(1),
})

export type BulkTodoInput = z.infer<typeof inputSchema>
export type BulkTodoResult = ActionResult<{
  readonly changedIds: readonly string[]
  readonly skippedCount: number
}>

/** Resolve one project context; never trust browser status or permission flags. */
export async function changeProjectTodosCommand(
  projectId: string,
  input: BulkTodoInput,
): Promise<BulkTodoResult> {
  try {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Select valid to-dos and an action." }
    const { db, user, organizationId } = await operationsContext(projectId, "tasks", true)
    const { mode, selection } = parsed.data
    if (mode === "delete" && !(await canFeature(user, "tasks", "delete")))
      return { success: false, error: "You do not have permission to delete to-dos." }
    if (new Set(selection.map((item) => item.id)).size !== selection.length)
      return { success: false, error: "Each to-do can only be selected once." }
    const groups = await Promise.all(
      chunkD1Values(selection.map((item) => item.id)).map((ids) =>
        db
          .select()
          .from(projectOperations)
          .where(
            and(
              eq(projectOperations.projectId, projectId),
              inArray(projectOperations.id, ids),
              inArray(projectOperations.sourceRecordType, [...PROJECT_TODO_RECORD_TYPES]),
            ),
          ),
      ),
    )
    const rows = groups.flat()
    const versions = new Map(selection.map((item) => [item.id, item.updatedAt]))
    if (
      rows.length !== selection.length ||
      rows.some((row) => versions.get(row.id) !== row.updatedAt)
    )
      return {
        success: false,
        error:
          "Some selected to-dos changed or are no longer available. Refresh and review the selection.",
      }
    if (
      rows.some((row) =>
        mode === "archive"
          ? isArchivedProjectTodoStatus(row.status)
          : !isArchivedProjectTodoStatus(row.status),
      )
    )
      return {
        success: false,
        error:
          mode === "archive"
            ? "Choose active to-dos to archive."
            : "Only archived to-dos can be restored or permanently deleted.",
      }
    const changedIds = await changeTodosReturning(
      db,
      projectId,
      rows,
      mode,
      new Date().toISOString(),
      { organizationId, userId: user.id },
    )
    revalidateProjectTodoPaths(projectId)
    return {
      success: true,
      data: { changedIds, skippedCount: selection.length - changedIds.length },
    }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to change selected to-dos.") }
  }
}
