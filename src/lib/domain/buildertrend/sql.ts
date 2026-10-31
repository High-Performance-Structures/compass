import type { BuildertrendStagingManifest, ChildReference } from "./rules"

/*
 * SQL literal and read-only expression helpers for the Buildertrend staging
 * generator. Nothing here writes; store.ts composes these into statements.
 */

export function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

export function sqlNumber(value: number | undefined): string {
  return value === undefined ? "NULL" : String(value)
}

export function jsonText(value: unknown): string {
  if (value === undefined) return "NULL"
  const encoded = JSON.stringify(value)
  return encoded === undefined ? "NULL" : sqlText(encoded)
}

export function stableId(
  kind: "run" | "source" | "file" | "access" | "observation",
  organizationId: string,
  key: string
): string {
  return `buildertrend:${kind}:${organizationId}:${key}`
}

export function scopedProjectId(
  organizationId: string,
  projectId: string | undefined
): string {
  if (!projectId) return "NULL"
  return `(SELECT id FROM projects WHERE id = ${sqlText(projectId)} AND organization_id = ${sqlText(organizationId)} LIMIT 1)`
}

export function scopedSourceRecordId(
  organizationId: string,
  reference: ChildReference
): string {
  if (!reference.sourceRecordKey) return "NULL"

  const projectCompatibility = reference.projectId
    ? ` AND (project_id IS NULL OR project_id = ${scopedProjectId(
        organizationId,
        reference.projectId
      )})`
    : ""

  return `(SELECT id FROM buildertrend_staging_records WHERE organization_id = ${sqlText(organizationId)} AND source_key = ${sqlText(reference.sourceRecordKey)}${projectCompatibility} LIMIT 1)`
}

export function activeRunGuardSql(
  organizationId: string,
  manifest: BuildertrendStagingManifest,
  fingerprint: string
): string {
  const runId = stableId("run", organizationId, manifest.runKey)
  return `EXISTS (
    SELECT 1 FROM buildertrend_staging_runs
    WHERE id = ${sqlText(runId)}
      AND organization_id = ${sqlText(organizationId)}
      AND manifest_fingerprint = ${sqlText(fingerprint)}
      AND status = 'in_progress'
  )`
}

export function initialReviewStatusSql(
  organizationId: string,
  reference: ChildReference
): string {
  const invalidChecks: string[] = []
  if (reference.projectId) {
    invalidChecks.push(
      `NOT EXISTS (SELECT 1 FROM projects WHERE id = ${sqlText(
        reference.projectId
      )} AND organization_id = ${sqlText(organizationId)})`
    )
  }
  if (reference.sourceRecordKey) {
    invalidChecks.push(
      `${scopedSourceRecordId(organizationId, reference)} IS NULL`
    )
  }

  if (invalidChecks.length === 0) return "'needs_review'"
  return `CASE WHEN ${invalidChecks.join(
    " OR "
  )} THEN 'unresolved_reference' ELSE 'needs_review' END`
}
