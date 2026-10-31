import { assemblyBuilderFeeAllocation } from "@/lib/estimates/assembly-builder-fee"
import type {
  ClientEstimateLine,
  ClientEstimatePhase,
  EstimateClientReportMode,
} from "@/lib/estimates/client-report"

/*
 * Print one assembly, division, or phase of an estimate. The section is one
 * group of the client report; its builder fee is its share of the estimate's
 * saved fee, allocated the same way the assembly report allocates it.
 */

export type EstimateReportSectionOption = {
  readonly id: string
  readonly label: string
}

export type EstimateReportSection = {
  readonly phase: ClientEstimatePhase
  readonly kind: string
  readonly label: string
  readonly subtotalCents: number
  readonly builderFeeCents: number
  readonly totalCents: number
}

function assemblyMode(mode: EstimateClientReportMode): boolean {
  return mode === "assembly_summary" || mode === "assembly_items"
}

function estimateReportSectionLabel(
  phase: ClientEstimatePhase,
  mode: EstimateClientReportMode
): string {
  if (phase.custom) return phase.name
  return `${phase.divisionCode} · ${mode === "division_summary" ? phase.divisionName : phase.description}`
}

function estimateReportSectionKind(
  phase: ClientEstimatePhase,
  mode: EstimateClientReportMode
): string {
  if (assemblyMode(mode)) return "Assembly"
  return phase.custom ? "Phase" : "Division"
}

/** The groups a print can be limited to, in report order. */
export function estimateReportSectionOptions(
  phases: readonly ClientEstimatePhase[],
  mode: EstimateClientReportMode
): readonly EstimateReportSectionOption[] {
  return phases.map((phase) => ({
    id: phase.id,
    label: `${estimateReportSectionKind(phase, mode)}: ${estimateReportSectionLabel(phase, mode)}`,
  }))
}

export function estimateReportSection(input: {
  readonly phases: readonly ClientEstimatePhase[]
  readonly lines: readonly ClientEstimateLine[]
  readonly mode: EstimateClientReportMode
  readonly builderFeeCents: number
  readonly sectionId: string | null | undefined
}): EstimateReportSection | null {
  if (!input.sectionId) return null
  const phase = input.phases.find((candidate) => candidate.id === input.sectionId)
  if (!phase) return null
  const fees = assemblyBuilderFeeAllocation({
    groups: input.phases,
    lines: input.lines,
    builderFeeCents: input.builderFeeCents,
  })
  const builderFeeCents = fees.byGroup.get(phase.id) ?? 0
  return {
    phase,
    kind: estimateReportSectionKind(phase, input.mode),
    label: estimateReportSectionLabel(phase, input.mode),
    subtotalCents: phase.subtotalCents,
    builderFeeCents,
    totalCents: phase.subtotalCents + builderFeeCents,
  }
}
