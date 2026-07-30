import { z } from "zod/v4"

export type BaselineTaskLike = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDateCalculated: string
  readonly workdays: number
}

export type BaselineVarianceRow = {
  readonly id: string
  readonly title: string
  readonly baselineStart: string | null
  readonly baselineFinish: string | null
  readonly currentStart: string | null
  readonly currentFinish: string | null
  readonly startVarianceDays: number | null
  readonly finishVarianceDays: number | null
  readonly durationVarianceDays: number | null
  readonly state: "existing" | "new" | "removed"
}

export type BaselineVarianceReport = {
  readonly baselineFinish: string | null
  readonly currentFinish: string | null
  readonly finishVarianceDays: number | null
  readonly delayedItemCount: number
  readonly aheadItemCount: number
  readonly rows: readonly BaselineVarianceRow[]
}

const baselineTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDateCalculated: z.string(),
  workdays: z.number(),
})

const baselineSnapshotSchema = z.object({
  tasks: z.array(baselineTaskSchema),
})

export function parseBaselineTasks(
  snapshotData: string
): readonly BaselineTaskLike[] | null {
  try {
    const result = baselineSnapshotSchema.safeParse(JSON.parse(snapshotData))
    return result.success ? result.data.tasks : null
  } catch {
    return null
  }
}

function dateOrdinal(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : null
}

function dateVariance(
  current: string,
  baseline: string
): number | null {
  const currentDay = dateOrdinal(current)
  const baselineDay = dateOrdinal(baseline)
  return currentDay === null || baselineDay === null
    ? null
    : currentDay - baselineDay
}

function latestDate(
  tasks: readonly BaselineTaskLike[]
): string | null {
  return tasks.reduce<string | null>(
    (latest, task) =>
      latest === null || task.endDateCalculated > latest
        ? task.endDateCalculated
        : latest,
    null
  )
}

export function scheduleBaselineVariance(
  currentTasks: readonly BaselineTaskLike[],
  baselineTasks: readonly BaselineTaskLike[]
): BaselineVarianceReport {
  const currentById = new Map(currentTasks.map((task) => [task.id, task]))
  const baselineById = new Map(baselineTasks.map((task) => [task.id, task]))
  const orderedIds = [
    ...currentTasks.map((task) => task.id),
    ...baselineTasks
      .map((task) => task.id)
      .filter((taskId) => !currentById.has(taskId)),
  ]

  const rows = orderedIds.flatMap((taskId): BaselineVarianceRow[] => {
    const current = currentById.get(taskId)
    const baseline = baselineById.get(taskId)
    if (current && baseline) {
      return [{
        id: taskId,
        title: current.title,
        baselineStart: baseline.startDate,
        baselineFinish: baseline.endDateCalculated,
        currentStart: current.startDate,
        currentFinish: current.endDateCalculated,
        startVarianceDays: dateVariance(
          current.startDate,
          baseline.startDate
        ),
        finishVarianceDays: dateVariance(
          current.endDateCalculated,
          baseline.endDateCalculated
        ),
        durationVarianceDays: current.workdays - baseline.workdays,
        state: "existing",
      }]
    }
    if (current) {
      return [{
        id: taskId,
        title: current.title,
        baselineStart: null,
        baselineFinish: null,
        currentStart: current.startDate,
        currentFinish: current.endDateCalculated,
        startVarianceDays: null,
        finishVarianceDays: null,
        durationVarianceDays: null,
        state: "new",
      }]
    }
    if (!baseline) return []
    return [{
      id: taskId,
      title: baseline.title,
      baselineStart: baseline.startDate,
      baselineFinish: baseline.endDateCalculated,
      currentStart: null,
      currentFinish: null,
      startVarianceDays: null,
      finishVarianceDays: null,
      durationVarianceDays: null,
      state: "removed",
    }]
  })
  const baselineFinish = latestDate(baselineTasks)
  const currentFinish = latestDate(currentTasks)

  return {
    baselineFinish,
    currentFinish,
    finishVarianceDays:
      baselineFinish && currentFinish
        ? dateVariance(currentFinish, baselineFinish)
        : null,
    delayedItemCount: rows.filter(
      (row) =>
        row.finishVarianceDays !== null && row.finishVarianceDays > 0
    ).length,
    aheadItemCount: rows.filter(
      (row) =>
        row.finishVarianceDays !== null && row.finishVarianceDays < 0
    ).length,
    rows,
  }
}
