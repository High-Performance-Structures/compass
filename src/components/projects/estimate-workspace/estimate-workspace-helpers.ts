/*
 * Pure helpers for the project estimate workspace: form readers, the line
 * editor draft, grouping and option lists. Money math stays in
 * src/lib/domain/estimates/rules.ts; these only turn draft text into its input.
 */

import type { EstimateAssembly } from "@/lib/estimates/assemblies"
import { groupEstimateAssemblies } from "@/lib/estimates/assemblies"
import { compareEstimateLineOrder } from "@/lib/estimates/line-order"
import type { EstimateLineCalculationInput } from "@/lib/domain/estimates/rules"
import { cleanText } from "@/lib/shared/guards"
import type {
  ProjectEstimateCostCodeOption,
  ProjectEstimateLineItem,
  ProjectEstimateTaxOption,
  ProjectEstimateTermsOption,
} from "@/app/actions/project-estimates"

export function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`
}

/** A trimmed, non-empty form field, or null. */
export function formText(formData: FormData, name: string): string | null {
  return cleanText(String(formData.get(name) ?? ""))
}

/** A form field as a number (commas ignored), or null when not finite. */
export function formNumber(formData: FormData, name: string): number | null {
  const value = Number(String(formData.get(name) ?? "").replaceAll(",", ""))
  return Number.isFinite(value) ? value : null
}

/** Draft text as a number (commas ignored); 0 when not finite. */
export function draftNumber(value: string): number {
  const parsed = Number(value.replaceAll(",", ""))
  return Number.isFinite(parsed) ? parsed : 0
}

export function statusLabel(value: string): string {
  return value.replaceAll("_", " ")
}

/** Today as "YYYY-MM-DD" in the browser's time zone. */
export function localDateInput(now: Date = new Date()): string {
  const localTime = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(localTime).toISOString().slice(0, 10)
}

export function selectedTemplateBody(
  options: readonly ProjectEstimateTermsOption[],
  templateId: string
): string {
  return options.find((option) => option.value === templateId)?.body ?? ""
}

export type LineDraft = {
  readonly assemblyId: string | null
  readonly id: string | null
  readonly reportPhaseId: string
  readonly divisionCode: string
  readonly costCode: string
  readonly description: string
  readonly specifications: string
  readonly quantity: string
  readonly unit: string
  readonly unitCost: string
  readonly markupPercent: string
  readonly taxable: boolean
  readonly taxEntityId: string
  readonly ownerVisible: boolean
  readonly includeInBuilderFee: boolean
  /** "Priced by" choice id; "" when not chosen. */
  readonly pricingSource: string
  /** Estimator for a new takeoff to-do; "" makes none. */
  readonly takeoffEstimatorId: string
}

export const EMPTY_LINE: LineDraft = {
  assemblyId: null,
  id: null,
  reportPhaseId: "",
  divisionCode: "",
  costCode: "",
  description: "",
  specifications: "",
  quantity: "1",
  unit: "LS",
  unitCost: "",
  markupPercent: "0",
  taxable: false,
  taxEntityId: "",
  ownerVisible: true,
  includeInBuilderFee: true,
  pricingSource: "",
  takeoffEstimatorId: "",
}

export function lineDraft(line: ProjectEstimateLineItem): LineDraft {
  return {
    assemblyId: line.assemblyId,
    id: line.id,
    reportPhaseId: line.reportPhaseId ?? "",
    divisionCode: line.divisionCode,
    costCode: line.costCode,
    description: line.description,
    specifications: line.specifications ?? "",
    quantity: String(line.quantity),
    unit: line.unit,
    unitCost: String(line.unitCostCents / 100),
    markupPercent: String(line.markupRateBasisPoints / 100),
    taxable: line.taxable,
    taxEntityId: line.taxEntityId ?? "",
    ownerVisible: line.ownerVisible,
    includeInBuilderFee: line.includeInBuilderFee,
    pricingSource: "",
    takeoffEstimatorId: "",
  }
}

/** The draft line as input for the shared calculateEstimateLine preview. */
export function lineDraftCalculationInput(
  line: LineDraft,
  taxRateBasisPoints: number
): EstimateLineCalculationInput {
  return {
    quantity: draftNumber(line.quantity),
    unitCostCents: Math.round(Math.max(0, draftNumber(line.unitCost)) * 100),
    markupRateBasisPoints: Math.round(
      Math.max(0, draftNumber(line.markupPercent)) * 100
    ),
    taxable: line.taxable,
    taxRateBasisPoints,
  }
}

/** Distinct CSI divisions from the cost codes, sorted by code. */
export function estimateDivisions(
  costCodes: readonly ProjectEstimateCostCodeOption[]
): [string, string][] {
  const options = new Map<string, string>()
  for (const option of costCodes) {
    options.set(option.divisionCode, option.divisionLabel)
  }
  return [...options.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )
}

export type TaxEntityComboboxOption = {
  readonly value: string
  readonly label: string
  readonly selectedLabel: string
  readonly description: string
  readonly keywords: string
}

export function taxEntityComboboxOptions(
  taxEntities: readonly ProjectEstimateTaxOption[]
): TaxEntityComboboxOption[] {
  return taxEntities.map((option) => ({
    value: option.value,
    label: option.label,
    selectedLabel: `${option.label} · ${percent(option.rateBasisPoints)}`,
    description: `${percent(option.rateBasisPoints)} · Sage tax entity`,
    keywords: `${option.code} ${option.rateBasisPoints / 100}`,
  }))
}

export type EstimateBuildView = "division" | "assembly"

export type EstimateLineGroup = {
  readonly key: string
  readonly assemblyId: string | null
  readonly name: string
  readonly description: string | null
  readonly items: readonly ProjectEstimateLineItem[]
}

/** Lines grouped by assembly or by CSI division (sorted, in line order). */
export function groupEstimateLines(
  buildView: EstimateBuildView,
  assemblies: readonly EstimateAssembly[],
  lines: readonly ProjectEstimateLineItem[]
): EstimateLineGroup[] {
  if (buildView === "assembly") return groupEstimateAssemblies(assemblies, lines).map((group) => ({
    key: group.id ?? "unassigned", assemblyId: group.id, name: group.name, description: group.description, items: group.lines,
  }))
  const groups = new Map<string, ProjectEstimateLineItem[]>()
  for (const item of lines) {
    const current = groups.get(item.divisionCode) ?? []
    current.push(item)
    groups.set(item.divisionCode, current)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([divisionCode, items]) => ({
    key: divisionCode, assemblyId: null, name: `${divisionCode} · ${items[0]?.divisionName}`, description: null, items: items.sort(compareEstimateLineOrder),
  }))
}

/**
 * Whether the line editor opens inline: under the line being edited or
 * inserted after, or at the end of the group it's added to. Falls back to the
 * bottom when that anchor isn't on screen (the view switched or the line was
 * removed).
 */
export function lineEditorIsInline(
  groups: readonly EstimateLineGroup[],
  editor: {
    readonly lineId: string | null
    readonly insertAfterLineId: string | null
    readonly addToGroupKey: string | null
  }
): boolean {
  const hasLine = (id: string): boolean =>
    groups.some((group) => group.items.some((item) => item.id === id))
  if (editor.lineId) return hasLine(editor.lineId)
  if (editor.insertAfterLineId) return hasLine(editor.insertAfterLineId)
  return editor.addToGroupKey !== null && groups.some((group) => group.key === editor.addToGroupKey)
}
