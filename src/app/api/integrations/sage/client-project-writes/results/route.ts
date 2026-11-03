import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import { sageClientWriteResultCustomerStatement } from "@/lib/domain/contacts/store"
import { sageJobResultStatement } from "@/lib/domain/project/store"
import {
  sageClientProjectWriteSucceededStatement,
  updateSageClientProjectWriteOperations,
} from "@/lib/domain/sage-bridge/store"
import {
  getSageBridgeSecret,
  readBoundedSageBridgeBody,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  sageClientProjectWriteResultSchema,
  sageClientProjectWritesEnabled,
} from "@/lib/sage/client-project-write"

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageBridgeSecret(env)
  if (!secret) {
    return Response.json({ error: "Sage bridge is not configured" }, { status: 503 })
  }
  if (!sageClientProjectWritesEnabled(env)) {
    return Response.json(
      { error: "Sage client/project writes are disabled" },
      { status: 503 }
    )
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    )
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const verification = await verifySageBridgeRequest(
    request,
    secret,
    body.rawBody
  )
  if (!verification.success) return unauthorized(verification.error)

  let parsed: unknown
  try {
    parsed = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const validated = sageClientProjectWriteResultSchema.safeParse(parsed)
  if (!validated.success) {
    return Response.json({ error: "Invalid Sage write result" }, { status: 400 })
  }

  const result = validated.data
  const db = getDb(env.DB)
  const operation = await db
    .select()
    .from(sageClientProjectWriteOperations)
    .where(
      and(
        eq(sageClientProjectWriteOperations.id, result.operationId),
        eq(sageClientProjectWriteOperations.claimToken, result.claimToken),
        eq(sageClientProjectWriteOperations.status, "running")
      )
    )
    .limit(1)
    .get()
  if (!operation) {
    return Response.json(
      { error: "Sage write claim is missing, stale, or already completed" },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  if (result.outcome === "failed") {
    await updateSageClientProjectWriteOperations(
      db,
      {
        status: "failed",
        errorMessage: result.error,
        completedAt: now,
        updatedAt: now,
      },
      eq(sageClientProjectWriteOperations.id, operation.id)
    )
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }

  const statements = [
    sageClientProjectWriteSucceededStatement(env.DB, {
      operationId: operation.id,
      clientId: result.client.id,
      clientNumber: result.client.number,
      clientStatusNumber: result.client.statusNumber,
      jobId: result.job?.id ?? null,
      jobNumber: result.job?.number ?? null,
      jobStatusNumber: result.job?.statusNumber ?? null,
      jobTypeNumber: result.job?.typeNumber ?? null,
      now,
    }),
  ]
  if (operation.customerId) {
    statements.push(
      sageClientWriteResultCustomerStatement(env.DB, {
        customerId: operation.customerId,
        sageClientId: result.client.id,
        sageClientNumber: result.client.number,
        sageClientStatusId: result.client.statusNumber,
        now,
      })
    )
  }
  if (operation.projectId && result.job) {
    statements.push(
      sageJobResultStatement(env.DB, {
        projectId: operation.projectId,
        sageJobId: result.job.id,
        sageJobNumber: result.job.number,
        sageJobStatusNumber: result.job.statusNumber,
        sageJobTypeNumber: result.job.typeNumber,
        now,
      })
    )
  }
  await env.DB.batch(statements)
  return Response.json({ success: true, status: "succeeded" })
}
