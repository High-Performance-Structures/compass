import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { sageSquarePaymentOperations } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  getSageBridgeSecret,
  readBoundedSageBridgeBody,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  isSageSquareWriterOperation,
  sageSquarePaymentResultSchema,
  sageSquareWritesEnabled,
} from "@/lib/sage/square-payment"
import { notifySageSquareException } from "@/lib/sage/square-payment-notifications"

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageBridgeSecret(env)
  if (!secret) {
    return Response.json({ error: "Sage bridge is not configured" }, { status: 503 })
  }
  if (!sageSquareWritesEnabled(env)) {
    return Response.json(
      { error: "Sage Square payment writes are disabled" },
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
  const validated = sageSquarePaymentResultSchema.safeParse(parsed)
  if (!validated.success) {
    return Response.json({ error: "Invalid Sage payment result" }, { status: 400 })
  }
  const result = validated.data
  const db = getDb(env.DB)
  const operation = await db
    .select()
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(sageSquarePaymentOperations.id, result.operationId),
        eq(sageSquarePaymentOperations.claimToken, result.claimToken),
        eq(sageSquarePaymentOperations.status, "running")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!operation) {
    return Response.json(
      { error: "Sage payment claim is missing, stale, or already completed" },
      { status: 409 }
    )
  }
  if (!isSageSquareWriterOperation(operation.operationType)) {
    return Response.json(
      { error: "Only Square processing-fee operations may use this writer" },
      { status: 409 }
    )
  }
  const now = new Date().toISOString()
  if (result.outcome === "failed") {
    await db
      .update(sageSquarePaymentOperations)
      .set({
        status: "failed",
        errorMessage: result.error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(sageSquarePaymentOperations.id, operation.id))
    await notifySageSquareException(
      env,
      operation.id,
      "Square payment could not be posted to Sage",
      `${operation.operationType} failed for Sage invoice ${operation.sageInvoiceNumber}: ${result.error}`
    )
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }
  await db
    .update(sageSquarePaymentOperations)
    .set({
      status: "succeeded",
      sageRecordId: result.sageRecordId,
      sageRecordNumber: result.sageRecordNumber,
      errorMessage: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(sageSquarePaymentOperations.id, operation.id))
  return Response.json({ success: true, status: "succeeded" })
}
