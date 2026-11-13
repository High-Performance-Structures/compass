/**
 * Runs the production drift detector (issue #1329): reads every registered
 * status column and the live schema, and returns the report. READ-ONLY: it
 * never writes app data. The daily job then hands the report to
 * ./notices.ts; the report endpoint and Settings › Data health only read it.
 */
import { declaredTableColumns } from "@/db/declared-schema"
import { KNOWN_MIGRATION_ONLY_SCHEMA, KNOWN_PRODUCTION_ONLY_SCHEMA } from "@/db/known-schema-differences"
import type { Db } from "@/lib/server/action-context"
import { envString } from "@/lib/shared/env"

import { readLiveSchema, readStatusFindings } from "./reads"
import { schemaDrift, type DataHealthReport } from "./rules"
import { STATUS_CHECKS } from "./status-checks"

export async function runDataHealthCheck(db: Db, now: Date = new Date()): Promise<DataHealthReport> {
  // One after the other, so the check never adds more than a few queries at once.
  const statusFindings = await readStatusFindings(db, STATUS_CHECKS)
  const live = await readLiveSchema(db)
  return {
    checkedAt: now.toISOString(),
    statusChecks: STATUS_CHECKS.filter((check) => check.kind !== "not_stored").length,
    statusFindings,
    schema: schemaDrift(declaredTableColumns(), live, [...KNOWN_MIGRATION_ONLY_SCHEMA, ...KNOWN_PRODUCTION_ONLY_SCHEMA]),
  }
}

/** The company that sees deployment-wide drift; null: every company (see seesDeploymentDrift). */
export function dataHealthOperatorOrganizationId(env: unknown): string | null {
  return envString(env, "DATA_HEALTH_OPERATOR_ORGANIZATION_ID")
}

/**
 * On-demand checks (Settings' Check now, an admin's report request) run at
 * most once per company per few minutes in this Worker instance, so repeated
 * clicks can't keep scanning production. Best effort: each instance keeps
 * its own clock.
 */
const ON_DEMAND_INTERVAL_MS = 5 * 60 * 1000
const lastOnDemand = new Map<string, { readonly at: number; readonly report: DataHealthReport }>()

export async function onDemandDataHealthCheck(db: Db, organizationId: string, now: Date = new Date()): Promise<DataHealthReport> {
  const last = lastOnDemand.get(organizationId)
  if (last && now.getTime() - last.at < ON_DEMAND_INTERVAL_MS) return last.report
  const report = await runDataHealthCheck(db, now)
  lastOnDemand.set(organizationId, { at: now.getTime(), report })
  return report
}
