export const SCHEDULE_SHIFT_REASON_MIN_LENGTH = 3
export const SCHEDULE_SHIFT_REASON_MAX_LENGTH = 500

type ScheduleDateUpdate = {
  readonly startDate: string
  readonly endDateCalculated: string
}

type ScheduleShiftTask = {
  readonly id: string
  readonly startDate: string
  readonly endDateCalculated: string
}

export type ScheduleShiftSummary = {
  readonly affectedItemCount: number
  readonly previousProjectEnd: string | null
  readonly nextProjectEnd: string | null
  readonly extendsProjectEnd: boolean
}

export type ScheduleShiftReasonResult =
  | { readonly success: true; readonly reason: string }
  | { readonly success: false; readonly error: string }

function latestEndDate(
  tasks: readonly Pick<ScheduleShiftTask, "endDateCalculated">[]
): string | null {
  let latest: string | null = null
  for (const task of tasks) {
    if (latest === null || task.endDateCalculated > latest) {
      latest = task.endDateCalculated
    }
  }
  return latest
}

export function validateScheduleShiftReason(
  value: string | null | undefined
): ScheduleShiftReasonResult {
  const reason = value?.trim() ?? ""
  if (reason.length < SCHEDULE_SHIFT_REASON_MIN_LENGTH) {
    return {
      success: false,
      error: "Enter a schedule shift reason (at least 3 characters)",
    }
  }
  if (reason.length > SCHEDULE_SHIFT_REASON_MAX_LENGTH) {
    return {
      success: false,
      error: "Schedule shift reason must be 500 characters or fewer",
    }
  }
  return { success: true, reason }
}

export function summarizeScheduleShift(
  tasks: readonly ScheduleShiftTask[],
  updates: ReadonlyMap<string, ScheduleDateUpdate>
): ScheduleShiftSummary {
  const previousProjectEnd = latestEndDate(tasks)
  let affectedItemCount = 0
  const nextTasks = tasks.map((task) => {
    const update = updates.get(task.id)
    if (!update) return task
    if (
      update.startDate !== task.startDate ||
      update.endDateCalculated !== task.endDateCalculated
    ) {
      affectedItemCount += 1
    }
    return {
      ...task,
      startDate: update.startDate,
      endDateCalculated: update.endDateCalculated,
    }
  })
  const nextProjectEnd = latestEndDate(nextTasks)

  return {
    affectedItemCount,
    previousProjectEnd,
    nextProjectEnd,
    extendsProjectEnd:
      previousProjectEnd !== null &&
      nextProjectEnd !== null &&
      nextProjectEnd > previousProjectEnd,
  }
}
