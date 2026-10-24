import type { ProjectDepartment } from "@/lib/project-branding"

export type WorkflowCarryover = {
  readonly from: ProjectDepartment
  readonly to: ProjectDepartment
  /** Source item key → target item key ("" carries nothing). */
  readonly items: Readonly<Record<string, string>>
}

/**
 * Design work that a Construction job repeats: when a D job is linked to an
 * O job, these completed D items tick the O items. Companies change it in
 * Settings → Workflows.
 */
export const DEFAULT_WORKFLOW_CARRYOVERS: readonly WorkflowCarryover[] = [
  {
    from: "D",
    to: "O",
    items: {
      "intake.program": "intake.details",
      "intake.meeting": "intake.meeting",
      "agreement.signed": "design_agreement.signed",
      "agreement.retainer": "design_agreement.retainer",
      "schematic.delivered": "site_plan.preliminary_plan",
      "development.estimate": "preliminary_estimate.sent",
      "engineering.engineering": "construction_documents.engineering",
      "engineering.finish_schedule": "preconstruction.selections",
      "deliverables.documents": "construction_documents.stamped_set",
      "deliverables.payment": "final_contract.payment",
    },
  },
]

/** The company's carryover from one department to another, or the default, or none. */
export function carryoverFor(
  saved: readonly WorkflowCarryover[] | undefined,
  from: ProjectDepartment,
  to: ProjectDepartment
): WorkflowCarryover | null {
  return (
    saved?.find((carryover) => carryover.from === from && carryover.to === to) ??
    DEFAULT_WORKFLOW_CARRYOVERS.find((carryover) => carryover.from === from && carryover.to === to) ??
    null
  )
}

export type CarriedTick = {
  readonly sourceKey: string
  readonly targetKey: string
  readonly checkedBy: string | null
  readonly checkedAt: string
}

/**
 * Which source ticks carry over: mapped to an item the target workflow shows
 * and lets someone tick, and not already ticked there. A target tick always
 * wins, so carrying over twice changes nothing.
 */
export function carriedTicks(input: {
  readonly items: Readonly<Record<string, string>>
  readonly sourceChecks: readonly { readonly itemKey: string; readonly checkedBy: string | null; readonly checkedAt: string }[]
  readonly targetTickableKeys: ReadonlySet<string>
  readonly targetCheckedKeys: ReadonlySet<string>
}): readonly CarriedTick[] {
  const claimed = new Set(input.targetCheckedKeys)
  const ticks: CarriedTick[] = []
  for (const check of input.sourceChecks) {
    const targetKey = input.items[check.itemKey]
    if (!targetKey || !input.targetTickableKeys.has(targetKey) || claimed.has(targetKey)) continue
    claimed.add(targetKey)
    ticks.push({ sourceKey: check.itemKey, targetKey, checkedBy: check.checkedBy, checkedAt: check.checkedAt })
  }
  return ticks
}
