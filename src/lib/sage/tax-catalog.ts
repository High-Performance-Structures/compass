import { z } from "zod/v4"

const taxDistrictSchema = z.object({
  sourceRecordId: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  ratePercent: z.number().finite().min(0).max(100),
})

export const sageTaxCatalogSchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  complete: z.literal(true),
  taxDistricts: z.array(taxDistrictSchema).min(1).max(1_000),
})

export type NormalizedSageTaxDistrict = {
  readonly sourceRecordId: string
  readonly code: string
  readonly name: string
  readonly rateBasisPoints: number
}

export type NormalizedSageTaxCatalog = {
  readonly capturedAt: string
  readonly taxDistricts: readonly NormalizedSageTaxDistrict[]
}

export type SageTaxCatalogParseResult =
  | { readonly success: true; readonly data: NormalizedSageTaxCatalog }
  | { readonly success: false; readonly error: string }

function normalizedBasisPoints(ratePercent: number): number {
  return Math.round(ratePercent * 1_000_000) / 10_000
}

export function parseSageTaxCatalog(
  input: unknown
): SageTaxCatalogParseResult {
  const parsed = sageTaxCatalogSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Invalid Sage tax catalog snapshot." }
  }

  const codes = new Set<string>()
  const sourceRecordIds = new Set<string>()
  const taxDistricts: NormalizedSageTaxDistrict[] = []
  for (const row of parsed.data.taxDistricts) {
    const normalizedCode = row.code.toUpperCase()
    if (codes.has(normalizedCode) || sourceRecordIds.has(row.sourceRecordId)) {
      return {
        success: false,
        error: "Sage tax catalog contains duplicate identifiers.",
      }
    }
    codes.add(normalizedCode)
    sourceRecordIds.add(row.sourceRecordId)
    taxDistricts.push({
      sourceRecordId: row.sourceRecordId,
      code: row.code,
      name: row.name,
      rateBasisPoints: normalizedBasisPoints(row.ratePercent),
    })
  }

  taxDistricts.sort((left, right) =>
    left.code.localeCompare(right.code, undefined, { numeric: true })
  )
  return {
    success: true,
    data: {
      capturedAt: parsed.data.capturedAt,
      taxDistricts,
    },
  }
}
