/**
 * Runs the production drift detector (issue #1329): reads every registered
 * status column and the live schema, and returns the report. READ-ONLY: it
 * never writes app data. The daily job then hands the report to
 * ./notices.ts; the report endpoint and Settings › Data health only read it.
 */
import { declaredTableColumns } from "@/db/declared-schema"
import { KNOWN_MIGRATION_ONLY_SCHEMA } from "@/db/known-schema-differences"
import type { Db } from "@/lib/server/action-context"

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
    schema: schemaDrift(declaredTableColumns(), live, KNOWN_MIGRATION_ONLY_SCHEMA),
  }
}
