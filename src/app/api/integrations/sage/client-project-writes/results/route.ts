import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
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
    await db
      .update(sageClientProjectWriteOperations)
      .set({
        status: "failed",
        errorMessage: result.error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(sageClientProjectWriteOperations.id, operation.id))
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }

  const statements = [
    env.DB.prepare(
      `UPDATE sage_client_project_write_operations
       SET status = 'succeeded', sage_client_id = ?, sage_client_number = ?,
           sage_job_id = ?, sage_job_number = ?,
           resolved_client_status_number = ?, resolved_job_status_number = ?,
           resolved_job_type_number = ?, error_message = NULL,
           completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      result.client.id,
      result.client.number,
      result.job?.id ?? null,
      result.job?.number ?? null,
      result.client.statusNumber,
      result.job?.statusNumber ?? null,
      result.job?.typeNumber ?? null,
      now,
      now,
      operation.id
    ),
  ]
  if (operation.customerId) {
    statements.push(
      env.DB.prepare(
        `UPDATE customers
         SET sage_client_id = ?, sage_client_number = ?,
             sage_client_status_id = ?, updated_at = ?
         WHERE id = ?`
      ).bind(
        result.client.id,
        result.client.number,
        result.client.statusNumber,
        now,
        operation.customerId
      )
    )
  }
  if (operation.projectId && result.job) {
    statements.push(
      env.DB.prepare(
        `UPDATE projects
         SET sage_job_id = ?, sage_job_number = ?,
             sage_job_status_number = ?, sage_job_type_number = ?, updated_at = ?
         WHERE id = ?`
      ).bind(
        result.job.id,
        result.job.number,
        result.job.statusNumber,
        result.job.typeNumber,
        now,
        operation.projectId
      )
    )
  }
  await env.DB.batch(statements)
  return Response.json({ success: true, status: "succeeded" })
}
