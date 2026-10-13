import { and, desc, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"

type Db = ReturnType<typeof getDb>
export type NuTechOrderRow = typeof nuTechOrderWorkflows.$inferSelect

/**
 * One of a job's Nu-Tech orders: the one asked for, or the job's newest when
 * none is named (jobs had one order before several were allowed).
 */
export async function findNuTechOrder(
  db: Db,
  projectId: string,
  orderId: string | null | undefined,
): Promise<NuTechOrderRow | undefined> {
  if (orderId) {
    return db
      .select()
      .from(nuTechOrderWorkflows)
      .where(and(eq(nuTechOrderWorkflows.id, orderId), eq(nuTechOrderWorkflows.projectId, projectId)))
      .get()
  }
  return db
    .select()
    .from(nuTechOrderWorkflows)
    .where(eq(nuTechOrderWorkflows.projectId, projectId))
    .orderBy(desc(nuTechOrderWorkflows.orderNumber))
    .limit(1)
    .get()
}

/** The next order number on a job. */
export async function nextNuTechOrderNumber(db: Db, projectId: string): Promise<number> {
  const latest = await db
    .select({ orderNumber: nuTechOrderWorkflows.orderNumber })
    .from(nuTechOrderWorkflows)
    .where(eq(nuTechOrderWorkflows.projectId, projectId))
    .orderBy(desc(nuTechOrderWorkflows.orderNumber))
    .limit(1)
    .get()
  return (latest?.orderNumber ?? 0) + 1
}
