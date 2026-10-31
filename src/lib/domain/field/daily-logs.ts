/**
 * Writing daily logs: create, edit (including moving a log to another
 * project) and review. Callers resolve access first and revalidate after.
 */
import { and, eq, inArray } from "drizzle-orm"

import { dailyLogPhotos, dailyLogs, ownerProjectUpdates, projectOperations } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { checkDailyLogForm, replaceDailyLogWorkLines } from "@/lib/daily-logs/cost-code-lines"
import { totalWorkLineHours, type DailyLogWorkLine, type DailyLogWorkLineDraft } from "@/lib/daily-logs/daily-log-form"
import { EMPTY_DAILY_LOG_FOLLOW_UPS, type DailyLogFollowUps } from "@/lib/daily-logs/log-followups"
import {
  applyDailyLogFollowUps,
  checkDailyLogFollowUps,
  linkedWorkLines,
  withoutTodosAlreadyMade,
} from "@/lib/daily-logs/log-followups-server"
import { normalizeDailyLogNotes } from "@/lib/daily-logs/notes"
import type { Db } from "@/lib/server/action-context"

import {
  dailyLogFormValues,
  normalizedDailyLogReviewStatus,
  normalizedLogDate,
  optionalText,
  parseIdList,
  requiredText,
} from "./rules"
import { insertDailyLog, setDailyLogReview } from "./store"

export type CreateDailyLogInput = {
  readonly clientSubmissionId?: string
  readonly logDate: string
  readonly weatherTempF: number | null
  readonly weatherConditions: string
  readonly weatherPrecipitation: string
  readonly workCompleted: string
  readonly issues: string
  readonly materialsUsed: string
  readonly crewPresent: string
  readonly hoursWorked: number | null
  readonly safetyIncidents: string
  readonly visitorLog: string
  readonly notes: string
  /**
   * Cost codes worked on, with time. Absent only from Field Mode builds made
   * before cost code lines; those logs skip the company's required-field rules.
   */
  readonly workLines?: readonly DailyLogWorkLineDraft[]
  /**
   * Saved on a phone and synced later: a cost code taken off the list in the
   * meantime is still accepted, so the log can't get stuck on the device.
   */
  readonly queuedOnDevice?: boolean
  /** To-dos ticked or created and client contact recorded with a new log. */
  readonly followUps?: DailyLogFollowUps
}

export type UpdateDailyLogInput = CreateDailyLogInput & {
  readonly dailyLogId: string
  readonly targetProjectId: string
}

type Failure = { readonly success: false; readonly error: string }

type CheckedLines = Extract<Awaited<ReturnType<typeof checkDailyLogForm>>, { readonly ok: true }>
type CheckedFollowUps = Extract<Awaited<ReturnType<typeof checkDailyLogFollowUps>>, { readonly ok: true }>

/** Hours come from the cost code lines when there are any. */
function loggedHours(lines: readonly DailyLogWorkLine[] | null, entered: number | null): number | null {
  return lines ? (totalWorkLineHours(lines) ?? entered) : entered
}

/** The content columns a new or edited log writes; edits go back to review. */
function dailyLogContent(
  input: CreateDailyLogInput,
  workCompleted: string,
  lines: readonly DailyLogWorkLine[] | null
) {
  return {
    weatherTempF: input.weatherTempF,
    weatherConditions: optionalText(input.weatherConditions),
    weatherPrecipitation: optionalText(input.weatherPrecipitation),
    weatherSource: "manual",
    workCompleted,
    issues: optionalText(input.issues),
    materialsUsed: optionalText(input.materialsUsed),
    crewPresent: optionalText(input.crewPresent),
    hoursWorked: loggedHours(lines, input.hoursWorked),
    safetyIncidents: optionalText(input.safetyIncidents),
    visitorLog: optionalText(input.visitorLog),
    notes: normalizeDailyLogNotes(workCompleted, input.notes),
    isClientVisible: false,
    reviewStatus: "needs_review",
    syncStatus: "pending",
  } as const
}

/**
 * `existing`: a retried submission whose log is already saved (nothing to
 * revalidate). `followUpsApplied`: to-dos changed too.
 */
type CreateDailyLogOutcome =
  | {
      readonly success: true
      readonly dailyLogId: string
      readonly existing: boolean
      readonly followUpsApplied: boolean
    }
  | Failure

export async function createDailyLog(
  db: Db,
  author: { readonly user: AuthUser; readonly orgId: string },
  projectId: string,
  input: CreateDailyLogInput
): Promise<CreateDailyLogOutcome> {
  const { user, orgId } = author
  const userId = user.id
  const clientSubmissionId = input.clientSubmissionId?.trim()
  const dailyLogId = clientSubmissionId || crypto.randomUUID()

  // Native Field Mode retries after interrupted requests. Reusing the client
  // UUID prevents a successful first request from creating a duplicate log.
  if (clientSubmissionId) {
    const [existing] = await db
      .select({ projectId: dailyLogs.projectId, authorId: dailyLogs.authorId })
      .from(dailyLogs)
      .where(eq(dailyLogs.id, dailyLogId))
      .limit(1)

    if (existing) {
      return existing.projectId === projectId && existing.authorId === userId
        ? { success: true, dailyLogId, existing: true, followUpsApplied: false }
        : { success: false, error: "Daily log submission ID is already in use." }
    }
  }
  const now = new Date().toISOString()
  const logDate = normalizedLogDate(input.logDate)
  const workCompleted = requiredText(input.workCompleted, "Work completed")
  const checked = input.workLines
    ? await checkDailyLogForm(db, orgId, projectId, dailyLogFormValues(input, input.workLines), null, input.queuedOnDevice === true)
    : null
  if (checked && !checked.ok) return { success: false, error: checked.error }
  const followUps = input.followUps
    ? await checkDailyLogFollowUps(db, orgId, projectId, logDate, input.followUps, input.queuedOnDevice === true)
    : null
  if (followUps && !followUps.ok) return { success: false, error: followUps.error }
  const lines = checked?.ok
    ? linkedWorkLines(checked.lines, new Set(followUps?.ok ? followUps.todos.keys() : []))
    : []

  await insertDailyLog(db, {
    id: dailyLogId,
    projectId,
    authorId: userId,
    sourceSystem: "compass",
    sourceExternalId: null,
    logDate,
    ...dailyLogContent(input, workCompleted, checked?.ok ? checked.lines : null),
    tags: null,
    createdAt: now,
    updatedAt: now,
  })
  if (checked?.ok) {
    await replaceDailyLogWorkLines(db, {
      organizationId: orgId,
      projectId,
      dailyLogId,
      logDate,
      userId,
      createdBy: userId,
      lines,
      options: checked.options,
    })
  }
  if (followUps?.ok) {
    await applyDailyLogFollowUps(db, {
      organizationId: orgId,
      projectId,
      dailyLogId,
      logDate,
      creator: user,
      workCompleted,
      lines,
      checked: followUps,
    })
  }

  return { success: true, dailyLogId, existing: false, followUpsApplied: followUps?.ok === true }
}

/** A log on the project, with its author. */
export async function findProjectDailyLog(
  db: Db,
  projectId: string,
  dailyLogId: string
): Promise<{ readonly id: string; readonly authorId: string | null } | null> {
  const [existing] = await db
    .select({ id: dailyLogs.id, authorId: dailyLogs.authorId })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))
    .limit(1)
  return existing ?? null
}

type CheckedDailyLogEdit =
  | {
      readonly success: true
      readonly logDate: string
      readonly workCompleted: string
      readonly now: string
      readonly checked: CheckedLines | null
      /** New to-dos from Issues and Notes lines, checked against the target project. */
      readonly lineTodos: CheckedFollowUps | null
      /** The columns the edit writes, on the project the log will belong to. */
      readonly values: ReturnType<typeof dailyLogContent> & {
        readonly projectId: string
        readonly logDate: string
        readonly updatedAt: string
      }
    }
  | Failure

/** Checks an edit against the project the log will belong to. */
export async function checkDailyLogEdit(
  db: Db,
  orgId: string,
  dailyLogId: string,
  targetProjectId: string,
  input: UpdateDailyLogInput
): Promise<CheckedDailyLogEdit> {
  const logDate = normalizedLogDate(input.logDate)
  const workCompleted = requiredText(input.workCompleted, "Work completed")
  const now = new Date().toISOString()
  // Lines are checked against the project the log will belong to.
  const checked = input.workLines
    ? await checkDailyLogForm(db, orgId, targetProjectId, dailyLogFormValues(input, input.workLines), dailyLogId, false)
    : null
  if (checked && !checked.ok) return { success: false, error: checked.error }
  // Editing adds to-dos from Issues and Notes lines only; the rest of a
  // log's follow-ups (worked, blocked, client contact) happen when it's written.
  const newTodos = await withoutTodosAlreadyMade(db, dailyLogId, input.followUps?.newTodos ?? [])
  const lineTodos = newTodos.length > 0
    ? await checkDailyLogFollowUps(db, orgId, targetProjectId, logDate, { ...EMPTY_DAILY_LOG_FOLLOW_UPS, newTodos })
    : null
  if (lineTodos && !lineTodos.ok) return { success: false, error: lineTodos.error }

  return {
    success: true,
    logDate,
    workCompleted,
    now,
    checked: checked?.ok ? checked : null,
    lineTodos: lineTodos?.ok ? lineTodos : null,
    values: {
      projectId: targetProjectId,
      logDate,
      ...dailyLogContent(input, workCompleted, checked?.ok ? checked.lines : null),
      updatedAt: now,
    },
  }
}

/**
 * Why a log can't move to another project: an owner update on its current
 * project still uses the log or one of its photos.
 */
export async function dailyLogMoveBlocker(
  db: Db,
  projectId: string,
  dailyLogId: string
): Promise<string | null> {
  const attachedPhotoRows = await db
    .select({ id: dailyLogPhotos.id })
    .from(dailyLogPhotos)
    .where(eq(dailyLogPhotos.dailyLogId, dailyLogId))
  const attachedPhotoIds = new Set(attachedPhotoRows.map((photo) => photo.id))
  const updateRows = await db
    .select({
      title: ownerProjectUpdates.title,
      sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
    })
    .from(ownerProjectUpdates)
    .where(eq(ownerProjectUpdates.projectId, projectId))
  const referencedUpdate = updateRows.find(
    (update) =>
      parseIdList(update.sourceDailyLogIds).includes(dailyLogId) ||
      parseIdList(update.selectedPhotoIds).some((photoId) => attachedPhotoIds.has(photoId))
  )
  return referencedUpdate
    ? `Remove this log and its photos from "${referencedUpdate.title}" before changing projects.`
    : null
}

/** Rewrites an edited log's cost code lines on the project it now belongs to. */
export async function replaceEditedWorkLines(
  db: Db,
  input: {
    readonly orgId: string
    readonly projectId: string
    readonly dailyLogId: string
    readonly logDate: string
    readonly userId: string
    readonly createdBy: string
    readonly checked: CheckedLines
  }
): Promise<void> {
  // A line keeps its to-do only while that to-do is on the log's project.
  const lineTodoIds = [...new Set(input.checked.lines.flatMap((line) => (line.todoId ? [line.todoId] : [])))]
  const projectTodoIds = lineTodoIds.length > 0
    ? await db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(and(eq(projectOperations.projectId, input.projectId), inArray(projectOperations.id, lineTodoIds)))
    : []
  await replaceDailyLogWorkLines(db, {
    organizationId: input.orgId,
    projectId: input.projectId,
    dailyLogId: input.dailyLogId,
    logDate: input.logDate,
    userId: input.userId,
    createdBy: input.createdBy,
    lines: linkedWorkLines(input.checked.lines, new Set(projectTodoIds.map((row) => row.id))),
    options: input.checked.options,
  })
}

export async function reviewDailyLog(
  db: Db,
  projectId: string,
  input: {
    readonly dailyLogId: string
    readonly reviewStatus: string
    readonly isClientVisible: boolean
  }
): Promise<{ readonly success: true } | Failure> {
  const dailyLogId = input.dailyLogId.trim()

  if (dailyLogId.length === 0) {
    return { success: false, error: "Daily log is required." }
  }

  const existing = await findProjectDailyLog(db, projectId, dailyLogId)
  if (!existing) {
    return { success: false, error: "Daily log not found." }
  }

  await setDailyLogReview(db, {
    dailyLogId,
    projectId,
    reviewStatus: normalizedDailyLogReviewStatus(input.reviewStatus),
    isClientVisible: input.isClientVisible,
    now: new Date().toISOString(),
  })
  return { success: true }
}
