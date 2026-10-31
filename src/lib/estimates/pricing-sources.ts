import { z } from "zod/v4"

/**
 * "Priced by" on an estimate line: who gives us the number for that cost code
 * and what Compass does about it (Settings → Workflows → Estimate pricing).
 *
 * - "rfq": a supplier or subcontractor quotes it.
 * - "owner_pricing": the owner provides the number (owner scope).
 * - "takeoff": our own staff take it off and price it; Compass makes a
 *   takeoff to-do for the estimator picked on the line.
 */
export const PRICING_SOURCE_ACTIONS = ["rfq", "owner_pricing", "takeoff"] as const
export type PricingSourceAction = (typeof PRICING_SOURCE_ACTIONS)[number]

/** Sage 100 Contractor's standard cost types; job cost lands in this column. */
export const SAGE_COST_TYPES = ["material", "labor", "equipment", "subcontract", "other"] as const
export type SageCostType = (typeof SAGE_COST_TYPES)[number]

export const SAGE_COST_TYPE_LABELS: Readonly<Record<SageCostType, string>> = {
  material: "Material",
  labor: "Labor",
  equipment: "Equipment",
  subcontract: "Subcontract",
  other: "Other",
}

export const PRICING_SOURCE_ACTION_LABELS: Readonly<Record<PricingSourceAction, string>> = {
  rfq: "Request a quote",
  owner_pricing: "Owner provides the number",
  takeoff: "Takeoff to-do for an estimator",
}

const pricingSourceSchema = z.object({
  /** Stored on estimate lines; never reuse an id for a different meaning. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes for the id."),
  label: z.string().trim().min(1).max(40),
  action: z.enum(PRICING_SOURCE_ACTIONS),
  sageCostType: z.enum(SAGE_COST_TYPES),
  /** Owner scope: the line stays out of builder fee and sales tax. */
  ownerScope: z.boolean(),
  active: z.boolean(),
})
export type PricingSource = z.infer<typeof pricingSourceSchema>

export const estimatePricingSettingsSchema = z.object({
  sources: z
    .array(pricingSourceSchema)
    .min(1)
    .max(20)
    .refine((sources) => new Set(sources.map((source) => source.id)).size === sources.length, "Each choice needs its own id."),
  /** Days a vendor's price link keeps working after the quote due date. */
  quoteLinkGraceDays: z.number().int().min(1).max(90),
  /** Days a price link works when the RFQ has no due date. */
  quoteLinkDaysWithoutDueDate: z.number().int().min(1).max(180),
})
export type EstimatePricingSettings = z.infer<typeof estimatePricingSettingsSchema>

export const DEFAULT_PRICING_SOURCES: readonly PricingSource[] = [
  { id: "supplier", label: "Supplier", action: "rfq", sageCostType: "material", ownerScope: false, active: true },
  { id: "subcontractor", label: "Subcontractor", action: "rfq", sageCostType: "subcontract", ownerScope: false, active: true },
  { id: "internal-labor", label: "Internal labor", action: "takeoff", sageCostType: "labor", ownerScope: false, active: true },
  // Material we supply ourselves (e.g. product the company sells).
  { id: "internal-material", label: "Internal material", action: "takeoff", sageCostType: "material", ownerScope: false, active: true },
  { id: "equipment", label: "Equipment", action: "takeoff", sageCostType: "equipment", ownerScope: false, active: true },
  { id: "owner", label: "Owner", action: "owner_pricing", sageCostType: "other", ownerScope: true, active: true },
]

export function findPricingSource(
  sources: readonly PricingSource[],
  id: string | null | undefined,
): PricingSource | null {
  if (!id) return null
  return sources.find((source) => source.id === id) ?? null
}

/** Choices offered on a line: active ones, plus the line's current one if it was turned off. */
export function pricingSourceChoices(sources: readonly PricingSource[], currentId: string | null): readonly PricingSource[] {
  return sources.filter((source) => source.active || source.id === currentId)
}

/** What happens next for a line priced this way, in plain words for the line editor. */
export function pricingSourceOutcome(source: PricingSource): string {
  const costType = SAGE_COST_TYPE_LABELS[source.sageCostType]
  switch (source.action) {
    case "rfq":
      return `Waiting on a quote. Sage cost type: ${costType}.`
    case "owner_pricing":
      return "Owner scope: the owner provides this number. It stays out of the builder fee and sales tax."
    case "takeoff":
      return `Our estimator takes this off and prices it. Sage cost type: ${costType}.`
  }
}

export function takeoffTodoTitle(input: { readonly costCode: string; readonly costCodeName: string; readonly estimateNumber: string | null }): string {
  const estimate = input.estimateNumber ? ` (estimate ${input.estimateNumber})` : ""
  return `Takeoff and price ${input.costCode} ${input.costCodeName}${estimate}`.slice(0, 200)
}

/** Blocks sending an estimate while any line is still waiting on its price. */
export function unpricedLinesMessage(
  lines: readonly { readonly costCode: string; readonly lineTotalCents: number }[],
): string | null {
  const waiting = lines.filter((line) => line.lineTotalCents <= 0)
  if (waiting.length === 0) return null
  const codes = waiting.slice(0, 5).map((line) => line.costCode).join(", ")
  const more = waiting.length > 5 ? ` and ${waiting.length - 5} more` : ""
  return `Price every line before signature. Still waiting: ${codes}${more}.`
}
