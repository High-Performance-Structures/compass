import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod/v4"

import { projects } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import { replaceSagePrimeChangeOrdersStatements } from "@/lib/domain/sage-bridge/change-order-store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeSageChangeOrderBridge, PRIME_CHANGE_ORDER_READER } from "@/lib/sage/change-order-bridge"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const cents = z.number().int().min(-10_000_000_000).max(100_000_000_000)

const lineSchema = z.strictObject({
  lineNumber: z.number().int().nonnegative(),
  description: z.string().max(200),
  costCode: z.string().max(30).nullable(),
  costType: z.number().int().nullable(),
  approvedAmountCents: cents,
})

const changeOrderSchema = z.strictObject({
  sageRecordId: z.string().regex(/^\d{1,12}$/),
  changeOrderNumber: z.string().max(40),
  changeOrderDate: isoDate,
  description: z.string().max(200),
  sageStatusNumber: z.number().int().nullable(),
  approvedAmountCents: cents,
  approvedDate: isoDate,
  lines: z.array(lineSchema).max(500),
})

const snapshotSchema = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  jobs: z
    .array(
      z.strictObject({
        projectId: z.string().min(1).max(100),
        sageJobNumber: z.string().regex(/^\d{1,12}$/),
        changeOrders: z.array(changeOrderSchema).max(1000),
      })
    )
    .max(300),
})

/**
 * The read-only Sage reader sends each job's prime change orders. Each
 * project's copy is replaced in one batch; a job whose Compass project moved
 * to another Sage job since the poll is skipped.
 */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, PRIME_CHANGE_ORDER_READER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = snapshotSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid prime change order snapshot" }, { status: 400 })
  const { db, organizationId } = bridge
  const snapshot = parsed.data
  if (snapshot.jobs.length === 0) return Response.json({ success: true, jobs: 0 })

  const known = (
    await Promise.all(
      chunkD1Values(snapshot.jobs.map((job) => job.projectId)).map((ids) =>
        db
          .select({ id: projects.id, sageJobNumber: projects.sageJobNumber })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, ids)))
      )
    )
  ).flat()
  const jobByProject = new Map(known.map((project) => [project.id, project.sageJobNumber?.trim() ?? null]))
  const current = snapshot.jobs.filter((job) => jobByProject.get(job.projectId) === job.sageJobNumber)
  const statements = current.flatMap((job) =>
      replaceSagePrimeChangeOrdersStatements(db, {
        projectId: job.projectId,
        sageJobNumber: job.sageJobNumber,
        capturedAt: snapshot.capturedAt,
        rows: job.changeOrders.map(({ lines, ...changeOrder }) => ({
          ...changeOrder,
          linesJson: JSON.stringify(lines),
        })),
      })
    )
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
  return Response.json({ success: true, jobs: current.length })
}
