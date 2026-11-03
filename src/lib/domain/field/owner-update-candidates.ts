/**
 * Owner update composer candidates: schedule items and to-dos that fall in
 * a reporting period, offered to staff while they write the update.
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import { projectOperations, scheduleTasks } from "@/db/schema"
import {
  isCompletedScheduleCandidate,
  isLookAheadScheduleCandidate,
  ownerUpdateTodoTiming,
} from "@/lib/owner-updates/composer"
import type {
  OwnerUpdateScheduleSelection,
  OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"
import { PROJECT_TODO_RECORD_TYPES, isArchivedProjectTodoStatus } from "@/lib/project-todos"
import type { Db } from "@/lib/server/action-context"

export async function getOwnerUpdateComposerCandidates(
  db: Db,
  projectId: string,
  periodStart: string,
  periodEnd: string
): Promise<{
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
}> {
  const [scheduleRows, todoRows] = await Promise.all([
    db
      .select({
        id: scheduleTasks.id,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedTo: scheduleTasks.assignedTo,
        status: scheduleTasks.status,
        percentComplete: scheduleTasks.percentComplete,
      })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder)),
    db
      .select({
        id: projectOperations.id,
        title: projectOperations.title,
        description: projectOperations.description,
        status: projectOperations.status,
        priority: projectOperations.priority,
        assigneeName: projectOperations.assigneeName,
        companyName: projectOperations.companyName,
        dueDate: projectOperations.dueDate,
        sourceRecordType: projectOperations.sourceRecordType,
      })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          inArray(projectOperations.sourceRecordType, [
            ...PROJECT_TODO_RECORD_TYPES,
          ])
        )
      )
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title)),
  ])

  const scheduleSelections = scheduleRows.map((item) => ({
    ...item,
    notes: "",
  }))
  const completedScheduleItems = scheduleSelections
    .filter((item) =>
      isCompletedScheduleCandidate(item, periodStart, periodEnd)
    )
    .slice(0, 20)
  const lookAheadScheduleItems = scheduleSelections
    .filter((item) => isLookAheadScheduleCandidate(item, periodEnd))
    .slice(0, 20)
  const todos = todoRows.flatMap((item) => {
    if (isArchivedProjectTodoStatus(item.status)) return []
    const timing = ownerUpdateTodoTiming(item.dueDate, periodStart, periodEnd)
    if (timing === null) return []
    return [
      {
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        priority: item.priority,
        assigneeName: item.assigneeName,
        companyName: item.companyName,
        dueDate: item.dueDate,
        timing,
        notes: "",
      },
    ]
  })

  return {
    completedScheduleItems,
    lookAheadScheduleItems,
    todos,
  }
}

export async function getOwnerUpdatePublishedScheduleItems(
  db: Db,
  projectId: string,
  selectedIds: readonly string[],
  periodStart: string | null,
  periodEnd: string | null
): Promise<{
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
}> {
  if (
    selectedIds.length === 0 ||
    periodStart === null ||
    periodEnd === null
  ) {
    return { completedScheduleItems: [], lookAheadScheduleItems: [] }
  }

  const rows = await db
    .select({
      id: scheduleTasks.id,
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      assignedTo: scheduleTasks.assignedTo,
      status: scheduleTasks.status,
      percentComplete: scheduleTasks.percentComplete,
    })
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        inArray(scheduleTasks.id, selectedIds)
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

  const selections = rows.map((row) => ({ ...row, notes: "" }))
  return {
    completedScheduleItems: selections.filter((item) =>
      isCompletedScheduleCandidate(item, periodStart, periodEnd)
    ),
    lookAheadScheduleItems: selections.filter((item) =>
      isLookAheadScheduleCandidate(item, periodEnd)
    ),
  }
}
