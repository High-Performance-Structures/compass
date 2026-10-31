/**
 * The only code that writes warranty claims, their event history and their
 * evidence attachments (architecture standard, section 1). No auth logic
 * here; callers resolve project and audience access first. Every write is
 * scoped to the claim's project.
 */
import { and, count, eq } from "drizzle-orm"

import {
  projectWarrantyClaimAttachments,
  projectWarrantyClaimEvents,
  projectWarrantyClaims,
} from "@/db/schema-warranty"
import type { Db } from "@/lib/server/action-context"

type NewWarrantyClaim = typeof projectWarrantyClaims.$inferInsert
type NewWarrantyClaimEvent = typeof projectWarrantyClaimEvents.$inferInsert
type NewWarrantyClaimAttachment = typeof projectWarrantyClaimAttachments.$inferInsert

type ClaimKey = { readonly claimId: string; readonly projectId: string }

function claimWhere(key: ClaimKey) {
  return and(eq(projectWarrantyClaims.id, key.claimId), eq(projectWarrantyClaims.projectId, key.projectId))
}

/** How many claims a project has, for numbering the next one. */
export async function countProjectWarrantyClaims(db: Db, projectId: string): Promise<number> {
  const row = await db
    .select({ total: count() })
    .from(projectWarrantyClaims)
    .where(eq(projectWarrantyClaims.projectId, projectId))
    .get()
  return row?.total ?? 0
}

export async function insertWarrantyClaim(db: Db, values: NewWarrantyClaim): Promise<void> {
  await db.insert(projectWarrantyClaims).values(values)
}

export async function updateWarrantyClaim(
  db: Db,
  key: ClaimKey,
  values: Partial<Omit<NewWarrantyClaim, "id" | "projectId" | "organizationId">>
): Promise<void> {
  await db.update(projectWarrantyClaims).set(values).where(claimWhere(key))
}

export async function deleteWarrantyClaim(db: Db, key: ClaimKey): Promise<void> {
  await db.delete(projectWarrantyClaims).where(claimWhere(key))
}

export async function insertWarrantyClaimEvent(db: Db, values: NewWarrantyClaimEvent): Promise<void> {
  await db.insert(projectWarrantyClaimEvents).values(values)
}

export async function insertWarrantyClaimAttachment(
  db: Db,
  values: NewWarrantyClaimAttachment
): Promise<void> {
  await db.insert(projectWarrantyClaimAttachments).values(values)
}
