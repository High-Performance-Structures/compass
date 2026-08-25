import "server-only"

import {
  parseSageTaxCatalog,
  type NormalizedSageTaxCatalog,
} from "@/lib/sage/tax-catalog"

type CurrentTaxDistrict = {
  readonly sourceRecordId: string | null
  readonly code: string
  readonly name: string
  readonly rateBasisPoints: number
  readonly active: number
}

export type SageTaxCatalogIngestResult =
  | {
      readonly success: true
      readonly changed: boolean
      readonly taxDistrictCount: number
    }
  | { readonly success: false; readonly error: string }

function catalogsMatch(
  currentRows: readonly CurrentTaxDistrict[],
  catalog: NormalizedSageTaxCatalog
): boolean {
  const activeRows = currentRows.filter((row) => row.active !== 0)
  if (activeRows.length !== catalog.taxDistricts.length) return false

  const currentByCode = new Map(activeRows.map((row) => [row.code, row]))
  return catalog.taxDistricts.every((district) => {
    const current = currentByCode.get(district.code)
    return Boolean(
      current &&
        current.sourceRecordId === district.sourceRecordId &&
        current.name === district.name &&
        Math.abs(current.rateBasisPoints - district.rateBasisPoints) < 0.000_001
    )
  })
}

function heartbeatStatement(
  env: CloudflareEnv,
  capturedAt: string
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sage_bridge_status (id, last_seen_at, updated_at)
     VALUES ('tax-catalog-poller', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).bind(capturedAt, capturedAt)
}

function upsertStatement(
  env: CloudflareEnv,
  catalog: NormalizedSageTaxCatalog,
  index: number
): D1PreparedStatement {
  const district = catalog.taxDistricts[index]
  if (!district) throw new Error("Missing normalized Sage tax district")
  return env.DB.prepare(
    `INSERT INTO sage_tax_entities (
       id, source_record_id, code, name, rate_basis_points, active,
       sync_status, last_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, 'synced', ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       source_record_id = excluded.source_record_id,
       name = excluded.name,
       rate_basis_points = excluded.rate_basis_points,
       active = 1,
       sync_status = 'synced',
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at`
  ).bind(
    `sage-taxdst-${district.code}`,
    district.sourceRecordId,
    district.code,
    district.name,
    district.rateBasisPoints,
    catalog.capturedAt,
    catalog.capturedAt,
    catalog.capturedAt
  )
}

export async function ingestSageTaxCatalog(
  env: CloudflareEnv,
  input: unknown
): Promise<SageTaxCatalogIngestResult> {
  const parsed = parseSageTaxCatalog(input)
  if (!parsed.success) return parsed

  const current = await env.DB.prepare(
    `SELECT source_record_id AS sourceRecordId, code, name,
            rate_basis_points AS rateBasisPoints, active
     FROM sage_tax_entities`
  ).all<CurrentTaxDistrict>()

  if (catalogsMatch(current.results, parsed.data)) {
    await heartbeatStatement(env, parsed.data.capturedAt).run()
    return {
      success: true,
      changed: false,
      taxDistrictCount: parsed.data.taxDistricts.length,
    }
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE sage_tax_entities
       SET active = 0, sync_status = 'inactive', updated_at = ?
       WHERE active != 0`
    ).bind(parsed.data.capturedAt),
  ]
  for (let index = 0; index < parsed.data.taxDistricts.length; index += 1) {
    statements.push(upsertStatement(env, parsed.data, index))
  }
  statements.push(heartbeatStatement(env, parsed.data.capturedAt))
  await env.DB.batch(statements)

  return {
    success: true,
    changed: true,
    taxDistrictCount: parsed.data.taxDistricts.length,
  }
}
