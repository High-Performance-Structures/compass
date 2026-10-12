import { and, eq, gte, inArray, lte } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { chunkD1Values } from "@/lib/d1-query"
import { sageLaborLines, sageLaborRequests, shopTicketLaborClaims } from "@/db/schema-shop-tickets"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const laborResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    requestId: z.string().min(1).max(100),
    claimToken: z.string().min(1).max(100),
    sageJobNumber: z.string().min(1).max(40),
    sageJobName: z.string().max(200).nullable(),
    lines: z
      .array(
        z.object({
          payrollRecord: z.string().min(1).max(40),
          lineNumber: z.string().min(1).max(20),
          workDate: isoDate,
          hours: z.number().min(-1000).max(1000),
          sageCostCode: z.string().max(40).nullable(),
          sageCostCodeName: z.string().max(200).nullable(),
          employeeName: z.string().max(120).nullable(),
        }),
      )
      .max(5000),
  }),
  z.object({
    ok: z.literal(false),
    requestId: z.string().min(1).max(100),
    claimToken: z.string().min(1).max(100),
    error: z.string().min(1).max(500),
  }),
])

export type SageLaborIngestResult =
  | { readonly success: true; readonly lineCount: number }
  | { readonly success: false; readonly error: string }

/** D1 caps statements per batch; write lines in chunks. */
const CHUNK = 50

/**
 * Stores a job's timecard lines for the request's dates. Lines Sage no longer
 * has are removed unless a ticket already billed them, so a claim is never
 * lost to a refresh.
 */
export async function ingestSageLaborResult(env: CloudflareEnv, input: unknown): Promise<SageLaborIngestResult> {
  const parsed = laborResultSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Invalid Sage labor result." }
  const result = parsed.data
  const db = getDb(env.DB)
  const request = await db
    .select()
    .from(sageLaborRequests)
    .where(and(eq(sageLaborRequests.id, result.requestId), eq(sageLaborRequests.claimToken, result.claimToken)))
    .limit(1)
    .get()
  if (!request || request.status !== "running") return { success: false, error: "The labor request is not claimed by this bridge." }
  const now = new Date().toISOString()

  if (!result.ok) {
    await db
      .update(sageLaborRequests)
      .set({ status: "failed", error: result.error, completedAt: now, updatedAt: now })
      .where(eq(sageLaborRequests.id, request.id))
    return { success: true, lineCount: 0 }
  }

  const rows = result.lines.map((line) => ({
    id: `${request.organizationId}:${line.payrollRecord}:${line.lineNumber}`,
    organizationId: request.organizationId,
    projectId: request.projectId,
    sageJobNumber: result.sageJobNumber,
    workDate: line.workDate,
    hours: line.hours,
    sageCostCode: line.sageCostCode,
    sageCostCodeName: line.sageCostCodeName,
    employeeName: line.employeeName,
    fetchedAt: now,
  }))
  const upsert = (row: (typeof rows)[number]) =>
    db
      .insert(sageLaborLines)
      .values(row)
      .onConflictDoUpdate({
        target: sageLaborLines.id,
        set: {
          projectId: row.projectId,
          sageJobNumber: row.sageJobNumber,
          workDate: row.workDate,
          hours: row.hours,
          sageCostCode: row.sageCostCode,
          sageCostCodeName: row.sageCostCodeName,
          employeeName: row.employeeName,
          fetchedAt: row.fetchedAt,
        },
      })
  for (let index = 0; index < rows.length; index += CHUNK) {
    const [first, ...rest] = rows.slice(index, index + CHUNK)
    if (first) await db.batch([upsert(first), ...rest.map(upsert)])
  }
  // Drop lines in these dates that Sage no longer has, unless already billed.
  const kept = new Set(rows.map((row) => row.id))
  const existing = await db
    .select({ id: sageLaborLines.id })
    .from(sageLaborLines)
    .where(
      and(
        eq(sageLaborLines.projectId, request.projectId),
        gte(sageLaborLines.workDate, request.dateFrom),
        lte(sageLaborLines.workDate, request.dateTo),
      ),
    )
  const gone = existing.map((row) => row.id).filter((id) => !kept.has(id))
  for (const chunk of chunkD1Values(gone)) {
    const billed = await db
      .select({ id: shopTicketLaborClaims.laborLineId })
      .from(shopTicketLaborClaims)
      .where(inArray(shopTicketLaborClaims.laborLineId, chunk))
    const billedIds = new Set(billed.map((row) => row.id))
    const removable = chunk.filter((id) => !billedIds.has(id))
    if (removable.length > 0) await db.delete(sageLaborLines).where(inArray(sageLaborLines.id, removable))
  }
  await db
    .update(sageLaborRequests)
    .set({
      status: "done",
      error: null,
      sageJobNumber: result.sageJobNumber,
      lineCount: rows.length,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(sageLaborRequests.id, request.id))
  return { success: true, lineCount: rows.length }
}

