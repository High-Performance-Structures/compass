/**
 * Department job workflows: each department's process as steps, each step a
 * checklist. An item is done when Compass already records it (a fact the
 * loader computes) or when someone ticks it. The first incomplete step is
 * current. Companies rename, hide and add items in Settings → Workflows.
 */

/** Facts a loader computes from the job's records, by name. */
export type WorkflowFacts = Readonly<Record<string, boolean>>

export type WorkflowItemDefinition = {
  readonly id: string
  readonly label: string
  /** Where the item is filled in, relative to the job; null for a plain tick. */
  readonly path: string | null
  /** Fact that completes the item automatically. */
  readonly fact?: string
  /** Whether someone may tick it. Items without a fact are always tickable. */
  readonly tickable?: boolean
  /** Shown only while this fact is true (or false, for "!fact"). */
  readonly when?: string
}

export type WorkflowStepDefinition = {
  readonly id: string
  readonly label: string
  /** Job status this step usually corresponds to; offered when it differs. */
  readonly jobStatusId: string | null
  readonly items: readonly WorkflowItemDefinition[]
}

export type WorkflowDefinition = {
  /** What the process produces, after the department's short name ("order", "scope of work"). */
  readonly title: string
  readonly steps: readonly WorkflowStepDefinition[]
}

/** A company's changes to one step; see the job-workflows settings group. */
export type WorkflowStepOverride = {
  readonly label?: string
  readonly hidden?: boolean
  readonly jobStatusId?: string | null
  readonly items?: Readonly<Record<string, { readonly label?: string; readonly hidden?: boolean }>>
  readonly extraItems?: readonly { readonly id: string; readonly label: string }[]
}

export type WorkflowOverrides = Readonly<Record<string, WorkflowStepOverride>>

export type WorkflowCheck = {
  readonly checkedAt: string
  readonly checkedByName: string | null
}

export type WorkflowItem = {
  /** Stable key for ticks: `${stepId}.${itemId}`. */
  readonly key: string
  readonly label: string
  readonly done: boolean
  /** How it was completed. */
  readonly source: "record" | "tick" | null
  readonly path: string | null
  readonly tickable: boolean
  readonly check: WorkflowCheck | null
}

export type WorkflowStep = {
  readonly id: string
  readonly label: string
  readonly state: "done" | "current" | "upcoming"
  readonly jobStatusId: string | null
  readonly items: readonly WorkflowItem[]
}

export type WorkflowProgress = {
  readonly title: string
  readonly steps: readonly WorkflowStep[]
  readonly current: WorkflowStep | null
  /** The first open item of the current step, as an instruction. */
  readonly nextAction: string | null
}

export function workflowItemKey(stepId: string, itemId: string): string {
  return `${stepId}.${itemId}`
}

function applies(when: string | undefined, facts: WorkflowFacts): boolean {
  if (!when) return true
  return when.startsWith("!") ? facts[when.slice(1)] !== true : facts[when] === true
}

/** The definition with a company's overrides applied: renamed, hidden and added items. */
export function applyWorkflowOverrides(definition: WorkflowDefinition, overrides: WorkflowOverrides): WorkflowDefinition {
  const steps = definition.steps
    .filter((step) => overrides[step.id]?.hidden !== true)
    .map((step): WorkflowStepDefinition => {
      const override = overrides[step.id]
      if (!override) return step
      const items = step.items
        .filter((item) => override.items?.[item.id]?.hidden !== true)
        .map((item) => {
          const label = override.items?.[item.id]?.label?.trim()
          return label ? { ...item, label } : item
        })
      const extras = (override.extraItems ?? []).map((extra): WorkflowItemDefinition => ({ id: extra.id, label: extra.label, path: null }))
      return {
        ...step,
        label: override.label?.trim() || step.label,
        jobStatusId: override.jobStatusId === undefined ? step.jobStatusId : override.jobStatusId,
        items: [...items, ...extras],
      }
    })
  return { ...definition, steps }
}

/**
 * Where a job stands. Steps whose items all fall away (every `when` false)
 * are skipped rather than shown empty.
 */
export function workflowProgress(
  definition: WorkflowDefinition,
  facts: WorkflowFacts,
  checks: ReadonlyMap<string, WorkflowCheck>,
): WorkflowProgress {
  let currentFound = false
  const steps: WorkflowStep[] = []
  for (const step of definition.steps) {
    const items = step.items
      .filter((item) => applies(item.when, facts))
      .map((item): WorkflowItem => {
        const key = workflowItemKey(step.id, item.id)
        const recorded = item.fact !== undefined && facts[item.fact] === true
        const check = checks.get(key) ?? null
        const tickable = item.fact === undefined || item.tickable === true
        const ticked = tickable && check !== null
        return {
          key,
          label: item.label,
          done: recorded || ticked,
          source: recorded ? "record" : ticked ? "tick" : null,
          path: item.path,
          tickable,
          check: tickable ? check : null,
        }
      })
    if (items.length === 0) continue
    const complete = items.every((item) => item.done)
    const state = !currentFound && !complete ? "current" : currentFound ? "upcoming" : "done"
    if (state === "current") currentFound = true
    steps.push({ id: step.id, label: step.label, state, jobStatusId: step.jobStatusId, items })
  }
  const current = steps.find((step) => step.state === "current") ?? null
  const nextItem = current?.items.find((item) => !item.done) ?? null
  return { title: definition.title, steps, current, nextAction: nextItem ? `${nextItem.label}.` : null }
}
