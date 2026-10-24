"use client"

import * as React from "react"
import { IconArrowDown, IconArrowUp, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { WorkflowCarryoverEditor } from "@/components/settings/workflow-carryover-editor"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { FEATURE_SETTINGS, jobWorkflowsSettingsSchema, type JobWorkflowsSettings } from "@/lib/feature-settings/registry"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import {
  orderedWorkflowSteps,
  type WorkflowCustomStep,
  type WorkflowOverrides,
  type WorkflowStepDefinition,
  type WorkflowStepOverride,
} from "@/lib/job-workflows/engine"
import type { ProjectDepartment } from "@/lib/project-branding"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import { cn } from "@/lib/utils"

const GROUP = FEATURE_SETTINGS["job-workflows"]
const NO_STATUS = "none"

const STATUS_OPTIONS: readonly SearchableComboboxOption[] = [
  { value: NO_STATUS, label: "No job status" },
  ...PROJECT_JOB_STATUS_DEFINITIONS.map((status) => ({ value: status.id, label: status.label })),
]

const WORKFLOW_DEPARTMENTS: readonly ProjectDepartment[] = DEPARTMENT_CODES.filter((code) => DEPARTMENT_WORKFLOWS[code] !== undefined)

function customItemId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
  return `custom-${slug || "item"}-${crypto.randomUUID().slice(0, 6)}`
}

/** One step's editor: place, name, visibility, job status, and its checklist. */
function StepEditor({
  step,
  override,
  disabled,
  onChange,
  position,
  onMove,
  custom,
}: {
  readonly step: WorkflowStepDefinition
  readonly override: WorkflowStepOverride
  readonly disabled: boolean
  readonly onChange: (next: WorkflowStepOverride) => void
  readonly position: { readonly index: number; readonly count: number }
  readonly onMove: (delta: -1 | 1) => void
  /** Set for steps the company added: renamed in place and removable. */
  readonly custom: { readonly onRename: (label: string) => void; readonly onRemove: () => void } | null
}): React.ReactElement {
  const [draft, setDraft] = React.useState("")
  const hidden = override.hidden === true
  const statusValue = (override.jobStatusId === undefined ? step.jobStatusId : override.jobStatusId) ?? NO_STATUS
  const setItem = (itemId: string, patch: { readonly label?: string; readonly hidden?: boolean }): void =>
    onChange({ ...override, items: { ...override.items, [itemId]: { ...override.items?.[itemId], ...patch } } })

  function addItem(): void {
    const label = draft.trim()
    if (!label) return
    onChange({ ...override, extraItems: [...(override.extraItems ?? []), { id: customItemId(label), label }] })
    setDraft("")
  }

  return (
    <li className="space-y-3 border-b py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:pr-1 sm:items-end">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`step-${step.id}`}>
              Step {position.index + 1}
              {custom ? <span className="ml-2 text-xs font-normal text-muted-foreground">Yours</span> : null}
            </Label>
            <div className="flex items-center">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Move ${step.label} earlier`}
                disabled={disabled || position.index === 0}
                onClick={() => onMove(-1)}
              >
                <IconArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Move ${step.label} later`}
                disabled={disabled || position.index === position.count - 1}
                onClick={() => onMove(1)}
              >
                <IconArrowDown className="size-4" />
              </Button>
              {custom ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Remove ${step.label}`}
                  disabled={disabled}
                  onClick={custom.onRemove}
                >
                  <IconTrash className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
          {custom ? (
            <Input
              id={`step-${step.id}`}
              value={step.label}
              disabled={disabled}
              onChange={(event) => custom.onRename(event.target.value)}
            />
          ) : (
            <Input
              id={`step-${step.id}`}
              value={override.label ?? ""}
              placeholder={step.label}
              disabled={disabled}
              onChange={(event) => onChange({ ...override, label: event.target.value })}
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`step-${step.id}-status`}>Goes with job status</Label>
          <SearchableCombobox
            id={`step-${step.id}-status`}
            ariaLabel={`${step.label} job status`}
            placeholder="No job status"
            options={STATUS_OPTIONS}
            value={statusValue}
            disabled={disabled}
            onValueChange={(value) => onChange({ ...override, jobStatusId: value === NO_STATUS ? null : value })}
          />
        </div>
        <div className="flex h-9 items-center gap-2">
          <Switch
            id={`step-${step.id}-shown`}
            checked={!hidden}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...override, hidden: !checked })}
          />
          <Label htmlFor={`step-${step.id}-shown`}>Show</Label>
        </div>
      </div>

      {hidden ? null : (
        <ul className="space-y-2 pl-0 sm:pl-4 sm:pr-1" aria-label={`${step.label} checklist`}>
          {step.items.map((item) => {
            const itemOverride = override.items?.[item.id]
            const itemHidden = itemOverride?.hidden === true
            return (
              <li key={item.id} className="flex min-w-0 items-center gap-3">
                <Input
                  aria-label={`${item.label} (checklist item)`}
                  value={itemOverride?.label ?? ""}
                  placeholder={item.label}
                  disabled={disabled || itemHidden}
                  onChange={(event) => setItem(item.id, { label: event.target.value })}
                  className={cn("h-8 min-w-0 flex-1", itemHidden && "line-through")}
                />
                <span className="hidden w-24 shrink-0 text-xs text-muted-foreground sm:inline">
                  {item.fact ? (item.tickable ? "Recorded or ticked" : "Recorded") : "Ticked"}
                </span>
                <Switch
                  aria-label={`Show ${item.label}`}
                  checked={!itemHidden}
                  disabled={disabled}
                  onCheckedChange={(checked) => setItem(item.id, { hidden: !checked })}
                />
              </li>
            )
          })}
          {(override.extraItems ?? []).map((extra) => (
            <li key={extra.id} className="flex min-w-0 items-center gap-3">
              <Input
                aria-label="Your checklist item"
                value={extra.label}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...override,
                    extraItems: (override.extraItems ?? []).map((entry) => (entry.id === extra.id ? { ...entry, label: event.target.value } : entry)),
                  })
                }
                className="h-8 flex-1"
              />
              <span className="hidden w-24 shrink-0 text-xs text-muted-foreground sm:inline">Ticked (yours)</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${extra.label}`}
                disabled={disabled}
                onClick={() => onChange({ ...override, extraItems: (override.extraItems ?? []).filter((entry) => entry.id !== extra.id) })}
              >
                <IconTrash className="size-4" />
              </Button>
            </li>
          ))}
          {disabled ? null : (
            <li className="flex items-center gap-2">
              <Input
                aria-label={`Add a checklist item to ${step.label}`}
                value={draft}
                placeholder="Add a checklist item"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addItem()
                  }
                }}
                className="h-8 flex-1"
              />
              <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={!draft.trim()}>
                Add
              </Button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** Drops blank labels so saved settings hold only real changes. */
function cleanOverrides(overrides: WorkflowOverrides): WorkflowOverrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([stepId, step]) => [
      stepId,
      {
        ...step,
        label: step.label?.trim() || undefined,
        items: step.items
          ? Object.fromEntries(Object.entries(step.items).map(([itemId, item]) => [itemId, { ...item, label: item.label?.trim() || undefined }]))
          : undefined,
      },
    ]),
  )
}

/**
 * Settings → Workflows → Job workflows: each department's overview steps and
 * checklists, renamed, hidden or added to by the company.
 */
export function JobWorkflowSettingsSection(): React.ReactElement {
  const profiles = useDepartmentProfiles()
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<JobWorkflowsSettings>(GROUP.defaults)
  const [active, setActive] = React.useState<ProjectDepartment>(WORKFLOW_DEPARTMENTS[0] ?? "H")
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("job-workflows")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = jobWorkflowsSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : GROUP.defaults)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const definition = DEPARTMENT_WORKFLOWS[active]
  const overrides: WorkflowOverrides = settings.departments[active] ?? {}
  const customSteps: readonly WorkflowCustomStep[] = settings.customSteps[active] ?? []
  const customIds = new Set(customSteps.map((step) => step.id))
  const steps = definition ? orderedWorkflowSteps(definition.steps, { order: settings.order[active] ?? [], customSteps }) : []
  const [newStep, setNewStep] = React.useState("")

  const setStep = (stepId: string, next: WorkflowStepOverride): void =>
    setSettings((current) => ({
      ...current,
      departments: { ...current.departments, [active]: { ...(current.departments[active] ?? {}), [stepId]: next } },
    }))
  const setCustomSteps = (next: readonly WorkflowCustomStep[]): void =>
    setSettings((current) => ({ ...current, customSteps: { ...current.customSteps, [active]: [...next] } }))

  function move(index: number, delta: -1 | 1): void {
    const ids = steps.map((step) => step.id)
    const target = index + delta
    const moving = ids[index]
    const other = ids[target]
    if (moving === undefined || other === undefined) return
    ids[index] = other
    ids[target] = moving
    setSettings((current) => ({ ...current, order: { ...current.order, [active]: ids } }))
  }

  function addStep(): void {
    const label = newStep.trim()
    if (!label) return
    const id = customItemId(label)
    setSettings((current) => ({
      ...current,
      customSteps: { ...current.customSteps, [active]: [...(current.customSteps[active] ?? []), { id, label, jobStatusId: null }] },
      // New steps go last, after the current order.
      order: { ...current.order, [active]: [...steps.map((step) => step.id), id] },
    }))
    setNewStep("")
  }

  function removeStep(id: string): void {
    setSettings((current) => {
      const remainingOverrides = Object.fromEntries(Object.entries(current.departments[active] ?? {}).filter(([stepId]) => stepId !== id))
      return {
        departments: { ...current.departments, [active]: remainingOverrides },
        order: { ...current.order, [active]: (current.order[active] ?? []).filter((stepId) => stepId !== id) },
        customSteps: { ...current.customSteps, [active]: (current.customSteps[active] ?? []).filter((step) => step.id !== id) },
      }
    })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const departments = Object.fromEntries(
      Object.entries(settings.departments).map(([code, value]) => [code, value ? cleanOverrides(value) : value]),
    )
    const emptyStep = Object.values(settings.customSteps).flatMap((list) => list ?? []).find((step) => step.label.trim() === "")
    if (emptyStep) {
      toast.error("Name every step you added, or remove it.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("job-workflows", { ...settings, departments })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Job workflows saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("job-workflows")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Job workflows reset to the built-in steps.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="job-workflow-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="job-workflow-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div role="tablist" aria-label="Department" className="flex flex-wrap border-b">
            {WORKFLOW_DEPARTMENTS.map((code) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={active === code}
                onClick={() => setActive(code)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  active === code ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {profiles[code].shortName}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            “Recorded” items complete themselves from what Compass already holds; “Ticked” items are checked off on the job overview. Leave a name blank to keep the built-in wording. Use the arrows to reorder steps; built-in steps can be hidden, and steps you add can be removed.
          </p>
          {definition ? (
            <ol aria-label={`${profiles[active].shortName} steps`}>
              {steps.map((step, index) => (
                <StepEditor
                  key={`${active}-${step.id}`}
                  step={step}
                  override={overrides[step.id] ?? {}}
                  disabled={disabled}
                  onChange={(next) => setStep(step.id, next)}
                  position={{ index, count: steps.length }}
                  onMove={(delta) => move(index, delta)}
                  custom={
                    customIds.has(step.id)
                      ? {
                          onRename: (label) => setCustomSteps(customSteps.map((entry) => (entry.id === step.id ? { ...entry, label } : entry))),
                          onRemove: () => removeStep(step.id),
                        }
                      : null
                  }
                />
              ))}
            </ol>
          ) : null}
          {definition && canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Add a step to the ${profiles[active].shortName} workflow`}
                value={newStep}
                placeholder="Add a step (for example, Site meeting)"
                onChange={(event) => setNewStep(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addStep()
                  }
                }}
                className="h-9 max-w-sm flex-1"
                disabled={pending}
              />
              <Button type="button" size="sm" variant="outline" onClick={addStep} disabled={pending || !newStep.trim()}>
                Add step
              </Button>
              <span className="text-xs text-muted-foreground">Then add its checklist items. A step shows on jobs once it has at least one.</span>
            </div>
          ) : null}
          {active === "O" ? (
            <WorkflowCarryoverEditor
              settings={settings}
              from="D"
              to="O"
              fromName={profiles.D.shortName}
              toName={profiles.O.shortName}
              disabled={disabled}
              onChange={setSettings}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to built-in steps</Button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change job workflows.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
