import { and, eq, gt } from "drizzle-orm"

import { getDb } from "@/db"
import { printSnapshots } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isPrintSnapshotKind, type PrintSnapshotKind } from "@/lib/print/snapshot-kinds"

export type PrintSnapshot = {
  readonly id: string
  readonly title: string
  readonly documentNumber: string | null
  readonly kind: PrintSnapshotKind
  readonly html: string
}

/**
 * The viewer's own unexpired snapshot. Snapshots hold markup the browser sent,
 * so no one but its creator ever opens one.
 */
export async function loadOwnPrintSnapshot(id: string): Promise<PrintSnapshot | null> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const row = await getDb(env.DB)
    .select()
    .from(printSnapshots)
    .where(
      and(
        eq(printSnapshots.id, id),
        eq(printSnapshots.userId, user.id),
        gt(printSnapshots.expiresAt, new Date().toISOString())
      )
    )
    .get()
  if (!row || !isPrintSnapshotKind(row.kind)) return null
  return { id: row.id, title: row.title, documentNumber: row.documentNumber, kind: row.kind, html: row.html }
}
