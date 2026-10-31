import {
  legacyAccessCandidatesSourceSql,
  legacyAccessObservationsSourceSql,
  legacyFileObservationsSourceSql,
  legacyFilesSourceSql,
  legacyGuardPreludeSql,
  legacyRecordObservationsSourceSql,
  legacyRecordsSourceSql,
  legacyRunsSourceSql,
} from "./legacy-sources"
import {
  legacyAccessCandidatesInsertSql,
  legacyFilesInsertSql,
  legacyObservationsInsertSql,
  legacyRecordsInsertSql,
  legacyRunsInsertSql,
} from "./store"

// Unlike the manifest generator's sqlText, this never maps empty text to NULL.
function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Builds an idempotent, archive-only bridge from the abandoned 0062 tables to
 * the guarded 0084 Buildertrend staging model. Operational Compass tables are
 * deliberately outside the scope of this reconciliation.
 */
export function buildLegacyBuildertrendReconciliationSql(
  defaultOrganizationId: string
): string {
  const organizationId = defaultOrganizationId.trim()
  if (organizationId.length === 0) {
    throw new Error("A default organization ID is required")
  }

  const defaultOrg = sqlText(organizationId)
  return [
    legacyGuardPreludeSql(defaultOrg),
    legacyRunsInsertSql(legacyRunsSourceSql(defaultOrg)),
    legacyRecordsInsertSql(legacyRecordsSourceSql(defaultOrg)),
    legacyFilesInsertSql(legacyFilesSourceSql(defaultOrg)),
    legacyAccessCandidatesInsertSql(legacyAccessCandidatesSourceSql(defaultOrg)),
    legacyObservationsInsertSql(legacyRecordObservationsSourceSql(defaultOrg)),
    legacyObservationsInsertSql(legacyFileObservationsSourceSql(defaultOrg)),
    legacyObservationsInsertSql(legacyAccessObservationsSourceSql(defaultOrg)),
    "DROP TABLE temp.buildertrend_reconciliation_guard;\n",
  ].join("\n\n")
}
