import { z } from "zod/v4"

const requiredText = z.string().trim().min(1)
const optionalText = requiredText.optional()
const reviewStatusSchema = z.enum(["needs_review", "approved", "rejected"])
const lifecycleStatusSchema = z.enum([
  "active",
  "preconstruction",
  "warranty",
  "completed",
  "inactive",
  "archived",
  "ignored",
])
const dispositionSchema = z.enum([
  "existing_project",
  "project_candidate",
  "lead_only",
  "archive_only",
  "ignored",
  "unmatched",
])
const customerProvenanceKindSchema = z.enum([
  "named_customer",
  "pooled_accounting",
  "prospect",
])
const relationshipTypeSchema = z.enum([
  "same_owner",
  "development_phase",
  "continuation",
  "department_transition",
  "lead_conversion",
])

const sourceIdentitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job"), id: requiredText }).strict(),
  z.object({ kind: z.literal("lead"), id: requiredText }).strict(),
])

const identityDecisionSchema = z
  .object({
    sourceKey: requiredText,
    sourceIdentity: sourceIdentitySchema,
    lifecycleStatus: lifecycleStatusSchema,
    disposition: dispositionSchema,
    departmentCode: optionalText,
    matchedProjectId: optionalText,
    customerProvenance: z
      .object({
        customerId: requiredText,
        kind: customerProvenanceKindSchema,
      })
      .strict()
      .optional(),
    reviewStatus: reviewStatusSchema.default("needs_review"),
    reviewNotes: optionalText,
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      decision.disposition === "existing_project" &&
      !decision.matchedProjectId
    ) {
      context.addIssue({
        code: "custom",
        message: "existing_project decisions require matchedProjectId",
        path: ["matchedProjectId"],
      })
    }
    if (
      decision.disposition === "lead_only" &&
      decision.sourceIdentity.kind !== "lead"
    ) {
      context.addIssue({
        code: "custom",
        message: "lead_only decisions require a lead source identity",
        path: ["disposition"],
      })
    }
    if (
      decision.lifecycleStatus === "ignored" &&
      decision.disposition !== "ignored" &&
      decision.disposition !== "archive_only"
    ) {
      context.addIssue({
        code: "custom",
        message: "ignored lifecycle records must remain ignored or archive_only",
        path: ["disposition"],
      })
    }
    if (
      decision.disposition === "ignored" &&
      decision.lifecycleStatus !== "ignored"
    ) {
      context.addIssue({
        code: "custom",
        message: "ignored dispositions require the ignored lifecycle status",
        path: ["lifecycleStatus"],
      })
    }
  })

const identityRelationshipSchema = z
  .object({
    fromSourceKey: requiredText,
    toSourceKey: requiredText,
    type: relationshipTypeSchema,
    reviewStatus: reviewStatusSchema.default("needs_review"),
    reviewNotes: optionalText,
  })
  .strict()
  .refine(
    (relationship) =>
      relationship.fromSourceKey !== relationship.toSourceKey,
    {
      message: "identity relationships must connect distinct source records",
      path: ["toSourceKey"],
    }
  )

export const buildertrendIdentityReviewManifestSchema = z
  .object({
    reviewKey: requiredText,
    reviewedAt: z.iso.datetime({ offset: true }),
    reviewedBy: optionalText,
    decisions: z.array(identityDecisionSchema).min(1).readonly(),
    relationships: z
      .array(identityRelationshipSchema)
      .readonly()
      .default([]),
  })
  .strict()

export type BuildertrendIdentityReviewManifest = z.infer<
  typeof buildertrendIdentityReviewManifestSchema
>

export type BuildertrendIdentityReviewParseResult =
  | {
      readonly success: true
      readonly data: BuildertrendIdentityReviewManifest
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
    }

export type BuildertrendIdentityReviewSummary = {
  readonly reviewKey: string
  readonly decisionCount: number
  readonly relationshipCount: number
  readonly approvedDecisionCount: number
  readonly pooledCustomerCount: number
  readonly leadConversionCount: number
}

export type BuildertrendIdentityReviewBuild = {
  readonly sql: string
  readonly statements: readonly string[]
  readonly summary: BuildertrendIdentityReviewSummary
}

type IdentityDecision = BuildertrendIdentityReviewManifest["decisions"][number]
type IdentityRelationship =
  BuildertrendIdentityReviewManifest["relationships"][number]

function stableTextCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => stableTextCompare(left, right))
      .map(([key, nestedValue]) => [key, canonicalJsonValue(nestedValue)])
  )
}

function canonicalManifest(
  manifest: BuildertrendIdentityReviewManifest
): BuildertrendIdentityReviewManifest {
  return {
    ...manifest,
    decisions: [...manifest.decisions].sort((left, right) =>
      stableTextCompare(left.sourceKey, right.sourceKey)
    ),
    relationships: [...manifest.relationships].sort((left, right) => {
      const leftKey = `${left.fromSourceKey}:${left.toSourceKey}:${left.type}`
      const rightKey = `${right.fromSourceKey}:${right.toSourceKey}:${right.type}`
      return stableTextCompare(leftKey, rightKey)
    }),
  }
}

async function manifestFingerprint(
  manifest: BuildertrendIdentityReviewManifest
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalJsonValue(canonicalManifest(manifest)))
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

function stableId(
  kind: "identity-run" | "identity-decision" | "identity-relationship",
  organizationId: string,
  key: string
): string {
  return `buildertrend:${kind}:${organizationId}:${key}`
}

function decisionId(
  organizationId: string,
  reviewKey: string,
  sourceKey: string
): string {
  return stableId(
    "identity-decision",
    organizationId,
    `${reviewKey}:${sourceKey}`
  )
}

function decisionErrors(
  manifest: BuildertrendIdentityReviewManifest
): readonly string[] {
  const errors: string[] = []
  const decisions = new Map<string, IdentityDecision>()
  const sourceIdentities = new Set<string>()

  for (const decision of manifest.decisions) {
    if (decisions.has(decision.sourceKey)) {
      errors.push(`Duplicate decision sourceKey: ${decision.sourceKey}`)
      continue
    }
    decisions.set(decision.sourceKey, decision)

    const identityKey = `${decision.sourceIdentity.kind}:${decision.sourceIdentity.id}`
    if (sourceIdentities.has(identityKey)) {
      errors.push(`Duplicate Buildertrend source identity: ${identityKey}`)
    }
    sourceIdentities.add(identityKey)
  }

  const relationshipKeys = new Set<string>()
  for (const relationship of manifest.relationships) {
    const from = decisions.get(relationship.fromSourceKey)
    const to = decisions.get(relationship.toSourceKey)
    if (!from) {
      errors.push(
        `Relationship references missing sourceKey: ${relationship.fromSourceKey}`
      )
    }
    if (!to) {
      errors.push(
        `Relationship references missing sourceKey: ${relationship.toSourceKey}`
      )
    }

    const edgeKey = `${relationship.fromSourceKey}:${relationship.toSourceKey}:${relationship.type}`
    if (relationshipKeys.has(edgeKey)) {
      errors.push(`Duplicate identity relationship: ${edgeKey}`)
    }
    relationshipKeys.add(edgeKey)

    if (
      relationship.type === "lead_conversion" &&
      from?.sourceIdentity.kind !== "lead"
    ) {
      errors.push("Lead conversion relationships must start with a lead")
    }
    if (
      relationship.type === "lead_conversion" &&
      to?.sourceIdentity.kind !== "job"
    ) {
      errors.push("Lead conversion relationships must end with a job")
    }
    if (
      relationship.type === "department_transition" &&
      from &&
      to &&
      (!from.departmentCode ||
        !to.departmentCode ||
        from.departmentCode === to.departmentCode)
    ) {
      errors.push(
        "Department transitions require distinct explicit department codes"
      )
    }
    if (
      relationship.reviewStatus === "approved" &&
      (from?.reviewStatus !== "approved" || to?.reviewStatus !== "approved")
    ) {
      errors.push(
        "Approved relationships require both identity decisions to be approved"
      )
    }
  }

  return errors
}

export function parseBuildertrendIdentityReviewManifest(
  input: unknown
): BuildertrendIdentityReviewParseResult {
  const parsed = buildertrendIdentityReviewManifestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`
      ),
    }
  }

  const errors = decisionErrors(parsed.data)
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: canonicalManifest(parsed.data) }
}

function sourceIdentityPredicate(decision: IdentityDecision): string {
  const column =
    decision.sourceIdentity.kind === "job"
      ? "buildertrend_job_id"
      : "buildertrend_lead_id"
  return `source_record.${column} = ${sqlText(decision.sourceIdentity.id)}`
}

function projectPredicate(
  organizationId: string,
  matchedProjectId: string | undefined
): string {
  if (!matchedProjectId) return "1 = 1"
  return `EXISTS (
    SELECT 1 FROM projects project
    WHERE project.id = ${sqlText(matchedProjectId)}
      AND project.organization_id = ${sqlText(organizationId)}
  )`
}

function customerPredicate(
  organizationId: string,
  decision: IdentityDecision
): string {
  if (!decision.customerProvenance) return "1 = 1"
  return `EXISTS (
    SELECT 1 FROM customers customer
    WHERE customer.id = ${sqlText(decision.customerProvenance.customerId)}
      AND customer.organization_id = ${sqlText(organizationId)}
  )`
}

function insertDecisionSql(
  organizationId: string,
  runId: string,
  reviewKey: string,
  fingerprint: string,
  reviewedAt: string,
  decision: IdentityDecision
): string {
  const id = decisionId(organizationId, reviewKey, decision.sourceKey)
  const customerId = decision.customerProvenance?.customerId
  const customerKind = decision.customerProvenance?.kind ?? "none"

  return `INSERT OR IGNORE INTO buildertrend_staging_identity_decisions (
  id, review_run_id, organization_id, source_record_id, source_key,
  source_identity_kind, source_identity_id, lifecycle_status, disposition,
  department_code, matched_project_id, customer_provenance_id,
  customer_provenance_kind, portal_identity_allowed, review_status,
  review_notes, created_at
)
SELECT
  ${sqlText(id)}, ${sqlText(runId)}, ${sqlText(organizationId)},
  source_record.id, ${sqlText(decision.sourceKey)},
  ${sqlText(decision.sourceIdentity.kind)},
  ${sqlText(decision.sourceIdentity.id)},
  ${sqlText(decision.lifecycleStatus)}, ${sqlText(decision.disposition)},
  ${sqlText(decision.departmentCode)}, ${sqlText(decision.matchedProjectId)},
  ${sqlText(customerId)}, ${sqlText(customerKind)}, 0,
  ${sqlText(decision.reviewStatus)}, ${sqlText(decision.reviewNotes)},
  ${sqlText(reviewedAt)}
FROM buildertrend_staging_records source_record
WHERE source_record.organization_id = ${sqlText(organizationId)}
  AND source_record.source_key = ${sqlText(decision.sourceKey)}
  AND ${sourceIdentityPredicate(decision)}
  AND ${projectPredicate(organizationId, decision.matchedProjectId)}
  AND ${customerPredicate(organizationId, decision)}
  AND EXISTS (
    SELECT 1
    FROM buildertrend_staging_identity_review_runs active_review
    WHERE active_review.id = ${sqlText(runId)}
      AND active_review.organization_id = ${sqlText(organizationId)}
      AND active_review.manifest_fingerprint = ${sqlText(fingerprint)}
      AND active_review.status = 'in_progress'
  )
LIMIT 1;`
}

function insertRelationshipSql(
  organizationId: string,
  runId: string,
  reviewKey: string,
  fingerprint: string,
  reviewedAt: string,
  relationship: IdentityRelationship
): string {
  const fromId = decisionId(
    organizationId,
    reviewKey,
    relationship.fromSourceKey
  )
  const toId = decisionId(
    organizationId,
    reviewKey,
    relationship.toSourceKey
  )
  const relationshipKey = `${reviewKey}:${relationship.fromSourceKey}:${relationship.toSourceKey}:${relationship.type}`
  const id = stableId(
    "identity-relationship",
    organizationId,
    relationshipKey
  )

  return `INSERT OR IGNORE INTO buildertrend_staging_identity_relationships (
  id, review_run_id, organization_id, from_decision_id, to_decision_id,
  relationship_type, review_status, review_notes, grants_portal_access,
  created_at
)
SELECT
  ${sqlText(id)}, ${sqlText(runId)}, ${sqlText(organizationId)},
  from_decision.id, to_decision.id, ${sqlText(relationship.type)},
  ${sqlText(relationship.reviewStatus)}, ${sqlText(relationship.reviewNotes)},
  0, ${sqlText(reviewedAt)}
FROM buildertrend_staging_identity_decisions from_decision
JOIN buildertrend_staging_identity_decisions to_decision
  ON to_decision.id = ${sqlText(toId)}
WHERE from_decision.id = ${sqlText(fromId)}
  AND from_decision.review_run_id = ${sqlText(runId)}
  AND to_decision.review_run_id = ${sqlText(runId)}
  AND EXISTS (
    SELECT 1
    FROM buildertrend_staging_identity_review_runs active_review
    WHERE active_review.id = ${sqlText(runId)}
      AND active_review.organization_id = ${sqlText(organizationId)}
      AND active_review.manifest_fingerprint = ${sqlText(fingerprint)}
      AND active_review.status = 'in_progress'
  )
LIMIT 1;`
}

function summary(
  manifest: BuildertrendIdentityReviewManifest
): BuildertrendIdentityReviewSummary {
  return {
    reviewKey: manifest.reviewKey,
    decisionCount: manifest.decisions.length,
    relationshipCount: manifest.relationships.length,
    approvedDecisionCount: manifest.decisions.filter(
      (decision) => decision.reviewStatus === "approved"
    ).length,
    pooledCustomerCount: manifest.decisions.filter(
      (decision) =>
        decision.customerProvenance?.kind === "pooled_accounting"
    ).length,
    leadConversionCount: manifest.relationships.filter(
      (relationship) => relationship.type === "lead_conversion"
    ).length,
  }
}

export async function buildBuildertrendIdentityReviewSql(
  organizationId: string,
  manifest: BuildertrendIdentityReviewManifest
): Promise<BuildertrendIdentityReviewBuild> {
  const normalizedOrganizationId = organizationId.trim()
  if (!normalizedOrganizationId) {
    throw new Error("organizationId is required")
  }

  const fingerprint = await manifestFingerprint(manifest)
  const runId = stableId(
    "identity-run",
    normalizedOrganizationId,
    manifest.reviewKey
  )
  const reviewSummary = summary(manifest)
  const statements = [
    "PRAGMA foreign_keys = ON;",
    "BEGIN IMMEDIATE;",
    `INSERT INTO buildertrend_staging_identity_review_runs (
  id, organization_id, review_key, manifest_fingerprint, status,
  expected_decision_count, expected_relationship_count, reviewed_by,
  reviewed_at, summary_json, created_at
) VALUES (
  ${sqlText(runId)}, ${sqlText(normalizedOrganizationId)},
  ${sqlText(manifest.reviewKey)}, ${sqlText(fingerprint)}, 'in_progress',
  ${manifest.decisions.length}, ${manifest.relationships.length},
  ${sqlText(manifest.reviewedBy)}, ${sqlText(manifest.reviewedAt)},
  ${sqlText(JSON.stringify(reviewSummary))}, ${sqlText(manifest.reviewedAt)}
)
ON CONFLICT (organization_id, review_key) DO UPDATE SET
  status = CASE
    WHEN buildertrend_staging_identity_review_runs.manifest_fingerprint
      = excluded.manifest_fingerprint
    THEN 'in_progress'
    ELSE 'manifest_conflict'
  END;`,
    ...manifest.decisions.map((decision) =>
      insertDecisionSql(
        normalizedOrganizationId,
        runId,
        manifest.reviewKey,
        fingerprint,
        manifest.reviewedAt,
        decision
      )
    ),
    ...manifest.relationships.map((relationship) =>
      insertRelationshipSql(
        normalizedOrganizationId,
        runId,
        manifest.reviewKey,
        fingerprint,
        manifest.reviewedAt,
        relationship
      )
    ),
    `UPDATE buildertrend_staging_identity_review_runs
SET status = 'completed'
WHERE id = ${sqlText(runId)}
  AND manifest_fingerprint = ${sqlText(fingerprint)}
  AND status = 'in_progress'
  AND (
    SELECT COUNT(*)
    FROM buildertrend_staging_identity_decisions
    WHERE review_run_id = ${sqlText(runId)}
  ) = expected_decision_count
  AND (
    SELECT COUNT(*)
    FROM buildertrend_staging_identity_relationships
    WHERE review_run_id = ${sqlText(runId)}
  ) = expected_relationship_count;`,
    "COMMIT;",
  ]

  return {
    sql: `${statements.join("\n\n")}\n`,
    statements,
    summary: reviewSummary,
  }
}
