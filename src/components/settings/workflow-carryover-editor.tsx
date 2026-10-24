"use client"

import type * as React from "react"

import { SearchableCombobox, type SearchableComboboxOption } from "@/components/searchable-combobox"
import type { JobWorkflowsSettings } from "@/lib/feature-settings/registry"
import { carryoverFor } from "@/lib/job-workflows/carryover-defaults"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import { applyWorkflowOverrides, workflowItemKey } from "@/lib/job-workflows/engine"
import type { ProjectDepartment } from "@/lib/project-branding"

const NONE = "none"

function appliedItems(settings: JobWorkflowsSettings, department: ProjectDepartment, tickableOnly: boolean) {
  const definition = DEPARTMENT_WORKFLOWS[department]
  if (!definition) return []
  const applied = applyWorkflowOverrides(definition, settings.departments[department] ?? {}, {
    order: settings.order[department] ?? [],
    customSteps: settings.customSteps[department] ?? [],
  })
  return applied.steps.flatMap((step) =>
    step.items
      .filter((item) => !tickableOnly || item.fact === undefined || item.tickable === true)
      .map((item) => ({ key: workflowItemKey(step.id, item.id), label: `${step.label} › ${item.label}` }))
  )
}

/**
 * Which completed items on a linked job in one department tick items on this
 * department's jobs (a Design job's agreement and drawings on its
 * Construction job). Saved with the rest of the job-workflow settings.
 */
export function WorkflowCarryoverEditor({
  settings,
  from,
  to,
  fromName,
  toName,
  disabled,
  onChange,
}: {
  readonly settings: JobWorkflowsSettings
  readonly from: ProjectDepartment
  readonly to: ProjectDepartment
  readonly fromName: string
  readonly toName: string
  readonly disabled: boolean
  readonly onChange: (next: JobWorkflowsSettings) => void
}): React.ReactElement | null {
  const carryover = carryoverFor(settings.carryovers, from, to)
  const sources = appliedItems(settings, from, true)
  if (!carryover || sources.length === 0) return null
  const targets: readonly SearchableComboboxOption[] = [
    { value: NONE, label: "Don't carry over" },
    ...appliedItems(settings, to, true).map((item) => ({ value: item.key, label: item.label })),
  ]

  function setTarget(sourceKey: string, targetKey: string): void {
    const items = { ...carryover?.items, [sourceKey]: targetKey === NONE ? "" : targetKey }
    const others = (settings.carryovers ?? []).filter((entry) => !(entry.from === from && entry.to === to))
    onChange({ ...settings, carryovers: [...others, { from, to, items }] })
  }

  return (
    <fieldset className="space-y-3 border-t pt-4" disabled={disabled}>
      <legend className="text-sm font-medium">Carried over from linked {fromName} jobs</legend>
      <p className="text-xs text-muted-foreground">
        When a {fromName} job is linked to a {toName} job, items already ticked on the {fromName} job are ticked here too, with who
        ticked them and when. Ticks already on the {toName} job are never changed.
      </p>
      <div className="grid gap-2">
        {sources.map((source) => (
          <div key={source.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
            <span className="text-sm">{source.label}</span>
            <SearchableCombobox
              options={targets}
              value={carryover.items[source.key] || NONE}
              onValueChange={(value) => setTarget(source.key, value)}
              placeholder="Don't carry over"
              ariaLabel={`${toName} item ticked by ${source.label}`}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    </fieldset>
  )
}
