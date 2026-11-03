"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { updateTask } from "@/app/actions/schedule"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import { countBusinessDays } from "@/lib/schedule/business-days"
import { resolveScheduleShiftReason } from "@/lib/schedule/shift-tracking"
import type { ScheduleTaskData, WorkdayExceptionData } from "@/lib/schedule/types"

/**
 * Saves a bar dragged to new dates, asking for a shift reason once the
 * schedule is published. A refused or failed save rebuilds the chart so the
 * bar returns to its saved dates.
 */
export function useGanttDateChange({
  tasks,
  exceptions,
  shiftReasonRequired,
  setGanttRevision,
}: {
  readonly tasks: readonly ScheduleTaskData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly shiftReasonRequired: boolean
  readonly setGanttRevision: (update: (revision: number) => number) => void
}): (task: FrappeTask, start: Date, end: Date) => Promise<void> {
  const router = useRouter()
  return useCallback(
    async (task: FrappeTask, start: Date, end: Date) => {
      if (task.id.startsWith("phase-")) return
      const startDate = format(start, "yyyy-MM-dd")
      const endDate = format(end, "yyyy-MM-dd")
      const scheduleTask = tasks.find(
        (candidate) => candidate.id === task.id
      )
      const taskExceptions = scheduleTask
        ? exceptions.filter(
            (exception) => exception.projectId === scheduleTask.projectId
          )
        : []
      const workdays = countBusinessDays(
        startDate,
        endDate,
        taskExceptions
      )
      const shiftReasonInput = shiftReasonRequired
        ? window.prompt(
            `Why is “${scheduleTask?.title ?? task.name}” shifting? This will be saved in schedule history.`
          )
        : ""
      const shiftReasonResult = resolveScheduleShiftReason(
        shiftReasonRequired,
        shiftReasonInput
      )
      if (shiftReasonResult !== null && !shiftReasonResult.success) {
        if (shiftReasonInput !== null) toast.error(shiftReasonResult.error)
        setGanttRevision((revision) => revision + 1)
        return
      }

      const result = await updateTask(task.id, {
        startDate,
        workdays: Math.max(1, workdays),
        shiftReason: shiftReasonResult?.reason,
      })

      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error)
        setGanttRevision((revision) => revision + 1)
      }
    },
    [exceptions, router, setGanttRevision, shiftReasonRequired, tasks]
  )
}
