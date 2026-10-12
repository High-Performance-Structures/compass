import { z } from "zod/v4"
import { RATE_BOOK_CATEGORIES, type RateBookCategory } from "@/db/schema-rate-book"

export { RATE_BOOK_CATEGORIES, type RateBookCategory }

export const RATE_BOOK_CATEGORY_LABEL: Readonly<Record<RateBookCategory, string>> = {
  labor: "Labor",
  machine: "Machine",
  delivery: "Delivery",
  fuel: "Fuel",
  travel: "Travel / zone",
  lodging: "Lodging & per diem",
  rental: "Equipment rental",
  material: "Material",
  subcontract: "Subcontract",
  other: "Other",
}

/** Common units, offered as suggestions; any short unit is accepted. */
export const RATE_BOOK_UNITS = ["hr", "man-hr", "day", "gal", "mi", "trip", "ea", "night", "ton", "cy", "sf", "lf", "ls"] as const

export type RateBookEntryInput = {
  readonly name: string
  readonly category: RateBookCategory
  readonly unit: string
  readonly unitCostCents: number
  readonly markupBasisPoints: number
  readonly divisionCode: string | null
  readonly divisionName: string | null
  readonly costCode: string | null
  readonly costCodeName: string | null
  readonly fuelType: "none" | "diesel" | "regular"
  readonly fuelGallonsPerUnit: number | null
  readonly notes: string | null
}

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().transform((value) => (value ? value : null))

export const rateBookEntryInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the rate a name.").max(120),
    category: z.enum(RATE_BOOK_CATEGORIES),
    unit: z.string().trim().min(1, "Choose a unit.").max(20),
    unitCostCents: z.number().int().min(0).max(100_000_000),
    markupBasisPoints: z.number().int().min(0).max(100_000),
    divisionCode: optionalText(20),
    divisionName: optionalText(120),
    costCode: optionalText(40),
    costCodeName: optionalText(120),
    fuelType: z.enum(["none", "diesel", "regular"]),
    fuelGallonsPerUnit: z.number().min(0).max(1000).nullable(),
    notes: optionalText(1000),
  })
  .transform((value) => ({
    ...value,
    // Fuel use only means something when a fuel type is chosen.
    fuelGallonsPerUnit: value.fuelType === "none" ? null : value.fuelGallonsPerUnit,
  }))

/** Fields an estimate cost item copies from a rate book entry. */
export type RateBookCostItemFill = {
  readonly description: string
  readonly unit: string
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
  readonly divisionCode: string | null
  readonly divisionName: string | null
  readonly costCode: string | null
  readonly costCodeName: string | null
  readonly rateBookEntryId: string
  readonly rateBookVersion: number
}

export function costItemFillFromEntry(entry: RateBookEntryInput & { readonly id: string; readonly version: number }): RateBookCostItemFill {
  return {
    description: entry.name,
    unit: entry.unit,
    unitCostCents: entry.unitCostCents,
    markupRateBasisPoints: entry.markupBasisPoints,
    divisionCode: entry.divisionCode,
    divisionName: entry.divisionName,
    costCode: entry.costCode,
    costCodeName: entry.costCodeName,
    rateBookEntryId: entry.id,
    rateBookVersion: entry.version,
  }
}

/** True when the fields a person sees changed (a pure note edit still counts). */
const ENTRY_FIELDS = [
  "name",
  "category",
  "unit",
  "unitCostCents",
  "markupBasisPoints",
  "divisionCode",
  "divisionName",
  "costCode",
  "costCodeName",
  "fuelType",
  "fuelGallonsPerUnit",
  "notes",
] as const satisfies readonly (keyof RateBookEntryInput)[]

export function entryChanged(before: RateBookEntryInput, after: RateBookEntryInput): boolean {
  return ENTRY_FIELDS.some((key) => before[key] !== after[key])
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatMarkup(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
}
