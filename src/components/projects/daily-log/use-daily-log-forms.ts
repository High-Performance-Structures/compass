"use client"

import * as React from "react"

import {
  createProjectDailyLog,
  getProjectWeatherSnapshot,
  updateProjectDailyLog,
} from "@/app/actions/project-field"
import type {
  ProjectDailyLogItem,
  ProjectDailyLogWorkspace,
} from "@/lib/domain/field/daily-log-workspace"
import type { DailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import {
  missingFieldsSummary,
  validateDailyLogForm,
  type DailyLogWorkLineDraft,
} from "@/lib/daily-logs/daily-log-form"
import {
  EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT,
  EMPTY_DAILY_LOG_FOLLOW_UPS,
  followUpsFromDraft,
  madeTodoTitles,
  savedLogTodoRules,
  todoTitleKey,
  toggleWorkedTodo,
  validateDailyLogFollowUps,
  workLinesAfterTick,
  type DailyLogFollowUpDraft,
} from "@/lib/daily-logs/log-followups"
import {
  draftFromLog,
  emptyDailyLogDraft,
  fieldElementId,
  weatherFilledMessage,
  withoutErrors,
  type DailyLogDraft,
  type DailyLogTextField,
} from "@/lib/daily-logs/workspace-view"
import { finiteNumber } from "@/lib/shared/guards"
import type { DailyLogFollowUpFields } from "@/components/projects/daily-log/daily-log-fields"

type ErrorMap = ReadonlyMap<string, string>

/** Props for one DailyLogFields form. */
type DailyLogFormBinding = {
  readonly draft: DailyLogDraft
  readonly idPrefix: string
  readonly updateDraft: (field: DailyLogTextField, value: string) => void
  readonly updateWorkLines: (lines: readonly DailyLogWorkLineDraft[]) => void
  readonly errors: ErrorMap
  readonly followUps: DailyLogFollowUpFields | undefined
}

export type DailyLogForms = {
  readonly editingLogId: string | null
  readonly editProjectId: string
  readonly setEditProjectId: (projectId: string) => void
  readonly savedLogSetup: DailyLogFollowUpSetup | null
  readonly savedButton: "new" | "edit" | null
  readonly isWeatherPending: boolean
  readonly newLog: DailyLogFormBinding
  readonly editLog: (log: ProjectDailyLogItem) => DailyLogFormBinding
  readonly startEditingLog: (log: ProjectDailyLogItem) => void
  readonly cancelEditingLog: () => void
  /** Closes the edit form after its log is deleted. */
  readonly clearEditingLog: () => void
  readonly cancelNewLog: () => void
  readonly submitDailyLog: (event: React.FormEvent<HTMLFormElement>) => void
  readonly submitDailyLogEdit: (event: React.FormEvent<HTMLFormElement>, log: ProjectDailyLogItem) => void
  readonly fillWeather: () => void
}

/** The new-log and edit-log forms: drafts, validation, saving and weather. */
export function useDailyLogForms({
  workspace,
  setMessage,
  startTransition,
  setShowNewLog,
  refresh,
  push,
}: {
  readonly workspace: ProjectDailyLogWorkspace
  readonly setMessage: (message: string | null) => void
  readonly startTransition: React.TransitionStartFunction
  readonly setShowNewLog: (show: boolean) => void
  readonly refresh: () => void
  readonly push: (href: string) => void
}): DailyLogForms {
  const [draft, setDraft] = React.useState<DailyLogDraft>(emptyDailyLogDraft)
  const [followUpDraft, setFollowUpDraft] = React.useState<DailyLogFollowUpDraft>(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT)
  const [editingLogId, setEditingLogId] = React.useState<string | null>(null)
  const [editProjectId, setEditProjectId] = React.useState(
    workspace.project.id
  )
  const [editDraft, setEditDraft] =
    React.useState<DailyLogDraft>(emptyDailyLogDraft)
  const [editFollowUpDraft, setEditFollowUpDraft] = React.useState<DailyLogFollowUpDraft>(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT)
  // Saved logs: lines become to-dos only when someone presses Make to-do.
  const savedLogSetup = React.useMemo(
    () => (workspace.followUps ? { ...workspace.followUps, rules: savedLogTodoRules(workspace.followUps.rules) } : null),
    [workspace.followUps],
  )
  const [isWeatherPending, startWeatherTransition] = React.useTransition()
  const [newLogErrors, setNewLogErrors] = React.useState<ErrorMap>(new Map())
  const [editErrors, setEditErrors] = React.useState<ErrorMap>(new Map())
  // Shows "Saved" on the button that saved, then returns to normal.
  const [savedButton, setSavedButton] = React.useState<"new" | "edit" | null>(null)
  React.useEffect(() => {
    if (savedButton === null) return
    const timer = window.setTimeout(() => setSavedButton(null), 4000)
    return () => window.clearTimeout(timer)
  }, [savedButton])

  React.useEffect(() => {
    setEditingLogId(null)
    setEditProjectId(workspace.project.id)
  }, [workspace.logs, workspace.project.id])

  function updateDraft(field: DailyLogTextField, value: string): void {
    setNewLogErrors((current) => withoutErrors(current, field))
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateEditDraft(field: DailyLogTextField, value: string): void {
    setEditErrors((current) => withoutErrors(current, field))
    setEditDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  /**
   * Checks the form against the company's rules. On a problem, shows each
   * field's message, says how many need attention and moves to the first.
   */
  function checkForm(
    values: DailyLogDraft,
    idPrefix: string,
    setErrors: (errors: ErrorMap) => void,
  ): readonly DailyLogWorkLineDraft[] | null {
    const { errors: formErrors } = validateDailyLogForm(values, workspace.form.requirements, workspace.form.costCodes)
    const setup = idPrefix === "daily-log" ? workspace.followUps : savedLogSetup
    const followUpErrors = setup
      ? validateDailyLogFollowUps(followUpsFromDraft(idPrefix === "daily-log" ? followUpDraft : editFollowUpDraft, values, setup.rules), setup.rules)
      : []
    const errors = [...formErrors, ...followUpErrors]
    setErrors(new Map(errors.map((error) => [error.key, error.message])))
    const [first] = errors
    if (!first) return values.workLines.filter((line) => line.costCode || line.hours || line.description)
    setMessage(missingFieldsSummary(errors))
    document.getElementById(fieldElementId(idPrefix, first.key))?.focus()
    return null
  }

  function startEditingLog(log: ProjectDailyLogItem): void {
    setMessage(null)
    setShowNewLog(false)
    setEditingLogId(log.id)
    setEditProjectId(workspace.project.id)
    setEditDraft(draftFromLog(log))
    setEditFollowUpDraft(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT)
  }

  function cancelEditingLog(): void {
    setEditingLogId(null)
    setEditProjectId(workspace.project.id)
    setEditDraft(emptyDailyLogDraft())
    setEditFollowUpDraft(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT)
  }

  function cancelNewLog(): void {
    setDraft(emptyDailyLogDraft())
    setShowNewLog(false)
  }

  function submitDailyLog(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setMessage(null)

    const workLines = checkForm(draft, "daily-log", setNewLogErrors)
    if (!workLines) return

    startTransition(async () => {
      const result = await createProjectDailyLog(workspace.project.id, {
        workLines,
        logDate: draft.logDate,
        weatherTempF: finiteNumber(draft.weatherTempF),
        weatherConditions: draft.weatherConditions,
        weatherPrecipitation: draft.weatherPrecipitation,
        workCompleted: draft.workCompleted,
        crewPresent: draft.crewPresent,
        hoursWorked: null,
        materialsUsed: draft.materialsUsed,
        issues: draft.issues,
        safetyIncidents: draft.safetyIncidents,
        visitorLog: draft.visitorLog,
        notes: draft.notes,
        ...(workspace.followUps
          ? { followUps: followUpsFromDraft(followUpDraft, draft, workspace.followUps.rules) }
          : {}),
      })

      if (result.success) {
        setDraft(emptyDailyLogDraft())
        setFollowUpDraft(EMPTY_DAILY_LOG_FOLLOW_UP_DRAFT)
        setNewLogErrors(new Map())
        setShowNewLog(false)
        setSavedButton("new")
        setMessage("Daily log saved. Review it before making it owner visible.")
        refresh()
      } else {
        setMessage(result.error)
      }
    })
  }

  function submitDailyLogEdit(
    event: React.FormEvent<HTMLFormElement>,
    log: ProjectDailyLogItem
  ): void {
    event.preventDefault()
    setMessage(null)

    const workLines = checkForm(editDraft, `daily-log-edit-${log.id}`, setEditErrors)
    if (!workLines) return

    startTransition(async () => {
      const result = await updateProjectDailyLog(workspace.project.id, {
        workLines,
        dailyLogId: log.id,
        targetProjectId: editProjectId,
        logDate: editDraft.logDate,
        weatherTempF: finiteNumber(editDraft.weatherTempF),
        weatherConditions: editDraft.weatherConditions,
        weatherPrecipitation: editDraft.weatherPrecipitation,
        workCompleted: editDraft.workCompleted,
        crewPresent: editDraft.crewPresent,
        // Old logs without cost code lines keep their recorded total.
        hoursWorked: log.workLines.length === 0 ? log.hoursWorked : null,
        materialsUsed: editDraft.materialsUsed,
        issues: editDraft.issues,
        safetyIncidents: editDraft.safetyIncidents,
        visitorLog: editDraft.visitorLog,
        notes: editDraft.notes,
        ...(savedLogSetup
          ? {
              followUps: {
                ...EMPTY_DAILY_LOG_FOLLOW_UPS,
                newTodos: followUpsFromDraft(editFollowUpDraft, editDraft, savedLogSetup.rules).newTodos.filter(
                  (todo) => !madeTodoTitles(log.todos).has(todoTitleKey(todo.title)),
                ),
              },
            }
          : {}),
      })

      if (result.success) {
        cancelEditingLog()
        setEditErrors(new Map())
        setSavedButton("edit")
        if (result.projectId === workspace.project.id) {
          setMessage("Daily log updated and returned to review.")
          refresh()
        } else {
          push(
            `/dashboard/projects/${result.projectId}/daily-logs#daily-log-${log.id}`
          )
        }
      } else {
        setMessage(result.error)
      }
    })
  }

  function fillWeather(): void {
    setMessage(null)
    startWeatherTransition(async () => {
      const result = await getProjectWeatherSnapshot(workspace.project.id, {
        logDate: draft.logDate,
      })

      if (!result.success) {
        setMessage(result.error)
        return
      }

      setDraft((current) => ({
        ...current,
        weatherTempF:
          result.weather.tempF === null ? "" : String(result.weather.tempF),
        weatherConditions: result.weather.conditions,
      }))
      setMessage(weatherFilledMessage(result.weather))
    })
  }

  const newLog: DailyLogFormBinding = {
    draft,
    idPrefix: "daily-log",
    updateDraft,
    updateWorkLines: (workLines) => {
      setNewLogErrors((current) => withoutErrors(current, "workLines"))
      setDraft((current) => ({ ...current, workLines }))
    },
    errors: newLogErrors,
    followUps: workspace.followUps ? {
      setup: workspace.followUps,
      draft: followUpDraft,
      onChange: (next) => {
        setNewLogErrors((current) => withoutErrors(current, "clientContacts"))
        setFollowUpDraft(next)
      },
      onToggleTodo: (todo) => {
        const ticked = !followUpDraft.worked.includes(todo.id)
        setFollowUpDraft((current) => toggleWorkedTodo(current, todo.id))
        if (workspace.followUps?.rules.tickAddsLine) {
          setDraft((current) => ({ ...current, workLines: workLinesAfterTick(current.workLines, todo, ticked) }))
        }
      },
    } : undefined,
  }

  function editLog(log: ProjectDailyLogItem): DailyLogFormBinding {
    return {
      draft: editDraft,
      idPrefix: `daily-log-edit-${log.id}`,
      updateDraft: updateEditDraft,
      updateWorkLines: (workLines) => {
        setEditErrors((current) => withoutErrors(current, "workLines"))
        setEditDraft((current) => ({ ...current, workLines }))
      },
      errors: editErrors,
      followUps: savedLogSetup ? {
        setup: savedLogSetup,
        draft: editFollowUpDraft,
        onChange: setEditFollowUpDraft,
        onToggleTodo: () => undefined,
        linesOnly: true,
        madeTitles: madeTodoTitles(log.todos),
      } : undefined,
    }
  }

  return {
    editingLogId,
    editProjectId,
    setEditProjectId,
    savedLogSetup,
    savedButton,
    isWeatherPending,
    newLog,
    editLog,
    startEditingLog,
    cancelEditingLog,
    clearEditingLog: () => setEditingLogId(null),
    cancelNewLog,
    submitDailyLog,
    submitDailyLogEdit,
    fillWeather,
  }
}
