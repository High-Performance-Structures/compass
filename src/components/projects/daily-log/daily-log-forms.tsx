"use client"

import * as React from "react"
import { IconCloud, IconTrash } from "@tabler/icons-react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import type { DailyLogFormSetup } from "@/lib/daily-logs/cost-code-lines"
import { missingFieldsSummary } from "@/lib/daily-logs/daily-log-form"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useProjectList } from "@/components/project-list-provider"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { DailyLogFields } from "@/components/projects/daily-log/daily-log-fields"
import type { DailyLogForms } from "@/components/projects/daily-log/use-daily-log-forms"

/** The New Daily Log form. */
export function DailyLogNewForm({
  forms,
  form,
  isPending,
}: {
  readonly forms: DailyLogForms
  readonly form: DailyLogFormSetup
  readonly isPending: boolean
}): React.ReactElement {
  const { newLog, isWeatherPending } = forms
  return (
    <section className="border-y py-4">
      <form onSubmit={forms.submitDailyLog} className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">New Daily Log</h2>
            <p className="text-sm text-muted-foreground">
              Saved logs enter review before owner visibility.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={forms.cancelNewLog}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving..." : "Save daily log"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3">
          <div>
            <p className="text-sm font-medium">Weather reference</p>
            <p className="text-xs text-muted-foreground">
              Uses the project address and selected log date.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isWeatherPending}
            onClick={forms.fillWeather}
          >
            <IconCloud className="size-4" />
            {isWeatherPending ? "Filling weather..." : "Fill weather"}
          </Button>
        </div>

        {newLog.errors.size > 0 && (
          <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
            {missingFieldsSummary([...newLog.errors.keys()])}
          </p>
        )}
        <DailyLogFields {...newLog} form={form} />
      </form>
    </section>
  )
}

/** The Edit Daily Log form, shown inside the log's card. */
export function DailyLogEditForm({
  log,
  forms,
  form,
  isPending,
  deletable,
  onDelete,
}: {
  readonly log: ProjectDailyLogItem
  readonly forms: DailyLogForms
  readonly form: DailyLogFormSetup
  readonly isPending: boolean
  readonly deletable: boolean
  readonly onDelete: () => void
}): React.ReactElement {
  const projects = useProjectList()
  const binding = forms.editLog(log)
  return (
    <form
      onSubmit={(event) => forms.submitDailyLogEdit(event, log)}
      className="mt-4 grid gap-4 border-t pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Edit Daily Log</h3>
          <p className="text-xs text-muted-foreground">
            Saving changes returns the log to review.
          </p>
        </div>
        <div className="flex gap-2">
          {deletable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={onDelete}
            >
              <IconTrash className="size-4" />
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={forms.cancelEditingLog}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving..." : "Save edits"}
          </Button>
        </div>
      </div>
      <div className="grid max-w-xl gap-1.5">
        <Label htmlFor={`daily-log-edit-project-${log.id}`}>
          Project
        </Label>
        <ProjectCombobox
          id={`daily-log-edit-project-${log.id}`}
          ariaLabel="Choose daily log project"
          projects={projects}
          value={forms.editProjectId}
          onValueChange={forms.setEditProjectId}
        />
        <p className="text-xs text-muted-foreground">
          Moving a log also moves its files and linked to-dos.
          Project-specific schedule links are cleared.
        </p>
      </div>
      {binding.errors.size > 0 && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {missingFieldsSummary([...binding.errors.keys()])}
        </p>
      )}
      <DailyLogFields {...binding} form={form} />
    </form>
  )
}
