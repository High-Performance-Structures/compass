"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  DailyLogWorkLines,
  FieldError,
  RequiredMark,
} from "@/components/projects/daily-log-work-lines"
import {
  DailyLogBlockedTodos,
  DailyLogClientContacts,
  DailyLogLineTodos,
  DailyLogTodoChecklist,
} from "@/components/projects/daily-log-followups"
import {
  isRequired,
  type DailyLogOptionalField,
  type DailyLogWorkLineDraft,
} from "@/lib/daily-logs/daily-log-form"
import type { DailyLogFormSetup } from "@/lib/daily-logs/cost-code-lines"
import type { DailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import type { DailyLogFollowUpDraft, DailyLogOpenTodo } from "@/lib/daily-logs/log-followups"
import type { DailyLogDraft, DailyLogTextField } from "@/lib/daily-logs/workspace-view"

/**
 * The to-do and client contact parts. A new log shows them all; editing a
 * saved log shows only Make to-do on its Issues and Notes lines.
 */
export type DailyLogFollowUpFields = {
  readonly setup: DailyLogFollowUpSetup
  readonly draft: DailyLogFollowUpDraft
  readonly onChange: (draft: DailyLogFollowUpDraft) => void
  readonly onToggleTodo: (todo: DailyLogOpenTodo) => void
  readonly linesOnly?: boolean
  /** Lines already made into to-dos on this log, by todoTitleKey. */
  readonly madeTitles?: ReadonlySet<string>
}

export function DailyLogFields({
  draft,
  idPrefix,
  updateDraft,
  updateWorkLines,
  form,
  errors,
  followUps,
}: {
  readonly draft: DailyLogDraft
  readonly idPrefix: string
  readonly updateDraft: (field: DailyLogTextField, value: string) => void
  readonly updateWorkLines: (lines: readonly DailyLogWorkLineDraft[]) => void
  readonly form: DailyLogFormSetup
  readonly errors: ReadonlyMap<string, string>
  readonly followUps?: DailyLogFollowUpFields
}): React.ReactElement {
  const rules = followUps?.setup.rules
  const allFollowUps = followUps && !followUps.linesOnly ? followUps : undefined
  const blockedTodos = followUps && rules?.carryBlocked
    ? followUps.setup.openTodos.filter((todo) => todo.status === "blocked")
    : []
  const checklistTodos = followUps
    ? followUps.setup.openTodos.filter((todo) => todo.status !== "blocked" || !rules?.carryBlocked)
    : []
  const todoTitles = React.useMemo(
    () => new Map((followUps?.setup.openTodos ?? []).map((todo) => [todo.id, todo.title])),
    [followUps?.setup.openTodos],
  )
  const required = (field: DailyLogOptionalField): boolean => isRequired(form.requirements, field)
  /** Props marking a field invalid and pointing at its error. */
  const invalid = (key: string): { readonly "aria-invalid"?: true; readonly "aria-describedby"?: string } =>
    errors.has(key) ? { "aria-invalid": true, "aria-describedby": `${idPrefix}-${key}-error` } : {}
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[160px_110px_1fr_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-date`}>
            Date
            <RequiredMark />
          </Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={draft.logDate}
            onChange={(event) =>
              updateDraft("logDate", event.currentTarget.value)
            }
            {...invalid("logDate")}
          />
          <FieldError id={`${idPrefix}-logDate-error`} message={errors.get("logDate")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-temp`}>Temp</Label>
          <Input
            id={`${idPrefix}-temp`}
            inputMode="numeric"
            value={draft.weatherTempF}
            onChange={(event) =>
              updateDraft("weatherTempF", event.currentTarget.value)
            }
            placeholder="F"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-weather`}>Weather</Label>
          <Input
            id={`${idPrefix}-weather`}
            value={draft.weatherConditions}
            onChange={(event) =>
              updateDraft("weatherConditions", event.currentTarget.value)
            }
            placeholder="Sunny, cloudy, windy..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-precipitation`}>Precipitation</Label>
          <Input
            id={`${idPrefix}-precipitation`}
            value={draft.weatherPrecipitation}
            onChange={(event) =>
              updateDraft("weatherPrecipitation", event.currentTarget.value)
            }
            placeholder="Optional field note..."
          />
        </div>
      </div>

      {allFollowUps && (
        <DailyLogBlockedTodos todos={blockedTodos} draft={allFollowUps.draft} onChange={allFollowUps.onChange} />
      )}

      {allFollowUps && rules && (
        <DailyLogTodoChecklist
          idPrefix={idPrefix}
          todos={checklistTodos}
          costCodes={form.costCodes}
          rules={rules}
          worked={allFollowUps.draft.worked}
          onToggle={allFollowUps.onToggleTodo}
        />
      )}

      <DailyLogWorkLines
        idPrefix={idPrefix}
        lines={draft.workLines}
        costCodes={form.costCodes}
        required={form.requirements.requireCostCodeTime}
        errors={errors}
        onChange={updateWorkLines}
        todoTitles={todoTitles}
      />

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-work`}>
          Work completed
          <RequiredMark />
        </Label>
        <Textarea
          id={`${idPrefix}-work`}
          value={draft.workCompleted}
          onChange={(event) =>
            updateDraft("workCompleted", event.currentTarget.value)
          }
          placeholder="Summarize progress, crews, inspections, and important field activity."
          className="min-h-28"
          {...invalid("workCompleted")}
        />
        <FieldError id={`${idPrefix}-workCompleted-error`} message={errors.get("workCompleted")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-crew`}>Who was on site{required("crewPresent") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-crew`}
            value={draft.crewPresent}
            onChange={(event) =>
              updateDraft("crewPresent", event.currentTarget.value)
            }
            placeholder="Companies, names, counts..."
            {...invalid("crewPresent")}
          />
          <FieldError id={`${idPrefix}-crewPresent-error`} message={errors.get("crewPresent")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-materials`}>Deliveries and materials{required("materialsUsed") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-materials`}
            value={draft.materialsUsed}
            onChange={(event) =>
              updateDraft("materialsUsed", event.currentTarget.value)
            }
            placeholder="Deliveries, materials used, shortages..."
            {...invalid("materialsUsed")}
          />
          <FieldError id={`${idPrefix}-materialsUsed-error`} message={errors.get("materialsUsed")} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="grid gap-1.5 lg:col-span-4">
          <Label htmlFor={`${idPrefix}-issues`}>Issues{required("issues") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-issues`}
            value={draft.issues}
            onChange={(event) =>
              updateDraft("issues", event.currentTarget.value)
            }
            placeholder="Delays, conflicts, blockers..."
            {...invalid("issues")}
          />
          <FieldError id={`${idPrefix}-issues-error`} message={errors.get("issues")} />
          {followUps && rules && (
            <DailyLogLineTodos
              idPrefix={idPrefix}
              source="issues"
              text={draft.issues}
              rules={rules}
              draft={followUps.draft}
              assignees={followUps.setup.assignees}
              costCodes={form.costCodes}
              onChange={followUps.onChange}
              madeTitles={followUps.madeTitles}
            />
          )}
        </div>
        <div className="grid gap-1.5 lg:col-span-4">
          <Label htmlFor={`${idPrefix}-safety`}>Safety{required("safetyIncidents") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-safety`}
            value={draft.safetyIncidents}
            onChange={(event) =>
              updateDraft("safetyIncidents", event.currentTarget.value)
            }
            placeholder="Incidents or no incidents."
            {...invalid("safetyIncidents")}
          />
          <FieldError id={`${idPrefix}-safetyIncidents-error`} message={errors.get("safetyIncidents")} />
        </div>
        <div className="grid gap-1.5 lg:col-span-4">
          <Label htmlFor={`${idPrefix}-visitors`}>Visitors{required("visitorLog") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-visitors`}
            value={draft.visitorLog}
            onChange={(event) =>
              updateDraft("visitorLog", event.currentTarget.value)
            }
            placeholder="Owners, inspectors, suppliers..."
            {...invalid("visitorLog")}
          />
          <FieldError id={`${idPrefix}-visitorLog-error`} message={errors.get("visitorLog")} />
        </div>
      </div>

      {allFollowUps && rules && (
        <DailyLogClientContacts
          idPrefix={idPrefix}
          rules={rules}
          contacts={allFollowUps.setup.clientContacts}
          visitorLog={draft.visitorLog}
          draft={allFollowUps.draft}
          errors={errors}
          onChange={allFollowUps.onChange}
        />
      )}

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes / next steps{required("notes") && <RequiredMark />}</Label>
          <Textarea
            id={`${idPrefix}-notes`}
            value={draft.notes}
            onChange={(event) =>
              updateDraft("notes", event.currentTarget.value)
            }
            placeholder="Follow-ups and next steps."
            {...invalid("notes")}
          />
          <FieldError id={`${idPrefix}-notes-error`} message={errors.get("notes")} />
          {followUps && rules && (
            <DailyLogLineTodos
              idPrefix={idPrefix}
              source="notes"
              text={draft.notes}
              rules={rules}
              draft={followUps.draft}
              assignees={followUps.setup.assignees}
              costCodes={form.costCodes}
              onChange={followUps.onChange}
              madeTitles={followUps.madeTitles}
            />
          )}
        </div>
      </div>
    </>
  )
}
