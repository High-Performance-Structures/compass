"use server"

import { and, asc, count, desc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { buildertrendWarrantyClaimStaging, projectWarrantyClaims } from "@/db/schema-warranty"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { warrantySourceEvidence, type WarrantySourceEvidence } from "@/lib/warranty/source-review"

type WarrantySourceReviewRecord = {
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

export type WarrantySourceReviewPage = {
  readonly records: readonly WarrantySourceReviewRecord[]
  readonly total: number
  readonly pageIndex: number
  readonly pageSize: number
}

export async function getProjectWarrantySourceReview(
  projectId: string,
  requestedPage = "1",
  requestedSize = "25",
): Promise<WarrantySourceReviewPage> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Historical warranty evidence is staff only.")
  await requireFeaturePermission(user, "warranty-claims", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  const scope = and(
    eq(buildertrendWarrantyClaimStaging.organizationId, organizationId),
    eq(buildertrendWarrantyClaimStaging.projectId, projectId),
  )
  const totals = await db.select({ total: count() }).from(buildertrendWarrantyClaimStaging).where(scope)
  const total = totals[0]?.total ?? 0
  const pageSize = requestedSize === "50" ? 50 : requestedSize === "100" ? 100 : 25
  const parsed = Number(requestedPage)
  const pageIndex = Math.min(
    Number.isSafeInteger(parsed) && parsed > 0 ? parsed - 1 : 0,
    Math.max(Math.ceil(total / pageSize) - 1, 0),
  )
  const rows = await db.select().from(buildertrendWarrantyClaimStaging).where(scope)
    .orderBy(desc(buildertrendWarrantyClaimStaging.sourceCreatedAt), asc(buildertrendWarrantyClaimStaging.sourceRecordId))
    .limit(pageSize).offset(pageIndex * pageSize)
  const claims = await db.select({ id: projectWarrantyClaims.id, claimNumber: projectWarrantyClaims.claimNumber, title: projectWarrantyClaims.title, status: projectWarrantyClaims.status })
    .from(projectWarrantyClaims).where(and(eq(projectWarrantyClaims.organizationId, organizationId), eq(projectWarrantyClaims.projectId, projectId)))
  return {
    total, pageSize, pageIndex,
    records: rows.map((row) => {
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
