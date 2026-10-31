import { z } from "zod/v4"

const fieldCostCodeSchema = z.object({
  code: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
})
export type FieldCostCode = z.infer<typeof fieldCostCodeSchema>

export const fieldCostCodeListSchema = z.array(fieldCostCodeSchema).max(300).refine(
  (codes) => new Set(codes.map((code) => code.code)).size === codes.length,
  "Each cost code can only be selected once.",
)
export const fieldCostCodeIdsSchema = z.array(z.string().trim().min(1).max(200)).max(300).refine(
  (codes) => new Set(codes).size === codes.length,
  "Each cost code can only be selected once.",
)
export const fieldCostCodeSettingsSchema = z.object({
  // Existing organizations retain their configured crew list until an admin saves this list.
  defaultCodes: fieldCostCodeListSchema.nullable(),
})
export type FieldCostCodeSettings = z.infer<typeof fieldCostCodeSettingsSchema>

export function parseProjectFieldCostCodes(raw: string | null | undefined): readonly FieldCostCode[] {
  if (!raw) return []
  try {
    const result = fieldCostCodeListSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : []
  } catch {
    return []
  }
}

/** Project overrides add choices; they never remove or replace inherited codes. */
export function mergeFieldCostCodes(defaults: readonly FieldCostCode[], additions: readonly FieldCostCode[]): readonly FieldCostCode[] {
  return [...new Map([...defaults, ...additions].map((code) => [code.code, code])).values()]
}
