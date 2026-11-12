"use server"

import { and, asc, count, desc, eq, like, or, sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { buildertrendWarrantyClaimStaging, projectWarrantyClaims } from "@/db/schema-warranty"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/domain/project/access"
import { actionFailure, type ActionResult } from "@/lib/action-result"
import { containsPattern, parseRecordPageQuery, type RecordPage } from "@/lib/record-page"
import { isInternalStaffRole } from "@/lib/user-roles"
import { warrantySourceEvidence, type WarrantySourceEvidence } from "@/lib/warranty/source-review"

export type WarrantySourceReviewRecord = {
  readonly id: string
  readonly claimNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly sourceStatus: string | null
  readonly sourcePriority: string | null
  readonly sourceCreatedAt: string | null
  readonly sourceUpdatedAt: string | null
  readonly reviewStatus: string
  readonly reviewNotes: string | null
  readonly evidence: WarrantySourceEvidence
  readonly existingClaim: { readonly claimNumber: string; readonly title: string; readonly status: string } | null
}

export type WarrantySourceReviewPage = RecordPage<WarrantySourceReviewRecord>

/** The sheet's sortable columns (list sheet "warranty.source-review"). */
const SORT_IDS = ["title", "created", "modified", "sourceStatus", "priority", "review"] as const

const table = buildertrendWarrantyClaimStaging
const ORDER_BY: Readonly<Record<(typeof SORT_IDS)[number], SQL>> = {
  title: sql`lower(${table.title})`,
  created: sql`${table.sourceCreatedAt}`,
  modified: sql`${table.sourceUpdatedAt}`,
  sourceStatus: sql`lower(${table.sourceStatus})`,
  priority: sql`lower(${table.sourcePriority})`,
  review: sql`${table.reviewStatus}`,
}

/**
 * One page of a project's imported warranty source records, searched, sorted
 * and paged on the server. Staff only; throws when access is refused.
 */
export async function getProjectWarrantySourceReview(
  projectId: string,
  rawQuery: unknown = {},
): Promise<WarrantySourceReviewPage> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Historical warranty evidence is staff only.")
  await requireFeaturePermission(user, "warranty-claims", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  const query = parseRecordPageQuery(rawQuery, SORT_IDS)
  const pattern = query.search ? containsPattern(query.search) : null
  const scope = and(
    eq(table.organizationId, organizationId),
    eq(table.projectId, projectId),
    pattern
      ? or(
          like(sql`lower(${table.title})`, pattern),
          like(sql`lower(coalesce(${table.sourceClaimNumber}, ''))`, pattern),
          like(sql`lower(coalesce(${table.sourceStatus}, ''))`, pattern),
          like(sql`lower(${table.reviewStatus})`, pattern),
        )
      : undefined,
  )
  const totals = await db.select({ total: count() }).from(table).where(scope)
  const total = totals[0]?.total ?? 0
  const pageSize = query.pageSize
  // A page past the end (records removed since) shows the last page.
  const pageIndex = Math.min(query.pageIndex, Math.max(Math.ceil(total / pageSize) - 1, 0))
  const sortId = SORT_IDS.find((id) => id === query.sortId)
  // Without a chosen sort: newest source record first, as before the sheet.
  const order = sortId
    ? [query.sortDesc ? sql`${ORDER_BY[sortId]} DESC` : sql`${ORDER_BY[sortId]} ASC`, asc(table.sourceRecordId)]
    : [desc(table.sourceCreatedAt), asc(table.sourceRecordId)]
  const rows = await db.select().from(table).where(scope)
    .orderBy(...order)
    .limit(pageSize).offset(pageIndex * pageSize)
  const claims = await db.select({ id: projectWarrantyClaims.id, claimNumber: projectWarrantyClaims.claimNumber, title: projectWarrantyClaims.title, status: projectWarrantyClaims.status })
    .from(projectWarrantyClaims).where(and(eq(projectWarrantyClaims.organizationId, organizationId), eq(projectWarrantyClaims.projectId, projectId)))
  return {
    total,
    rows: rows.map((row) => {
      const evidence = warrantySourceEvidence(row.rawPayloadJson)
      const existing = claims.find((claim) => claim.id === evidence.duplicateClaimId)
      return {
        id: row.id, claimNumber: row.sourceClaimNumber, title: row.title,
        description: row.description, sourceStatus: row.sourceStatus, sourcePriority: row.sourcePriority,
        sourceCreatedAt: row.sourceCreatedAt, sourceUpdatedAt: row.sourceUpdatedAt,
        reviewStatus: row.reviewStatus, reviewNotes: row.reviewNotes,
        evidence: { ...evidence, duplicateClaimId: null },
        existingClaim: existing ? { claimNumber: existing.claimNumber, title: existing.title, status: existing.status } : null,
      }
    }),
  }
}

/** The sheet's later pages, searches and sorts, read from the browser. */
export async function loadProjectWarrantySourceReviewPage(projectId: string, rawQuery: unknown): Promise<ActionResult<WarrantySourceReviewPage>> {
  try {
    return { success: true, data: await getProjectWarrantySourceReview(projectId, rawQuery) }
  } catch (error) {
    console.error("Failed to load historical warranty records", error)
    return actionFailure("Could not load historical warranty records.")
  }
}
