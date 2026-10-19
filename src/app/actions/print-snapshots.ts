"use server"

import { lt } from "drizzle-orm"

import { getDb } from "@/db"
import { printSnapshots } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import {
  PRINT_SNAPSHOT_LIFETIME_MS,
  PRINT_SNAPSHOT_MAX_HTML_LENGTH,
  isPrintSnapshotKind,
} from "@/lib/print/snapshot-kinds"

export type CreatePrintSnapshotInput = {
  readonly projectId: string | null
  readonly kind: string
  readonly title: string
  readonly documentNumber: string | null
  /** The print root's inner markup, as the browser assembled it. */
  readonly html: string
}

/** Saves a browser-assembled document so Print Preview can render it to PDF. */
export async function createPrintSnapshot(
  input: CreatePrintSnapshotInput
): Promise<{ readonly success: true; readonly id: string } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (!isPrintSnapshotKind(input.kind)) return { success: false, error: "That document can't be previewed." }
    if (input.html.length === 0) return { success: false, error: "There is nothing to print." }
    if (input.html.length > PRINT_SNAPSHOT_MAX_HTML_LENGTH) {
      return { success: false, error: "This document is too large to preview. Narrow the filters and try again." }
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    if (input.projectId) await assertProjectAccess(db, user, input.projectId)
    const now = new Date()
    // Expired snapshots are cleared as new ones are made.
    await db.delete(printSnapshots).where(lt(printSnapshots.expiresAt, now.toISOString()))
    const id = crypto.randomUUID()
    await db.insert(printSnapshots).values({
      id,
      userId: user.id,
      projectId: input.projectId,
      title: input.title.trim().slice(0, 200) || "Document",
      documentNumber: input.documentNumber?.trim().slice(0, 200) || null,
      html: input.html,
      kind: input.kind,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PRINT_SNAPSHOT_LIFETIME_MS).toISOString(),
    })
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to prepare the preview." }
  }
}
