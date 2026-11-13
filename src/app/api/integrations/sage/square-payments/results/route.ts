import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { sageSquarePaymentOperations } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  finishSageSquareFeeOperation,
  recordFailureOnFlaggedSageSquareOperation,
  recordResultOnFlaggedSageSquareOperation,
} from "@/lib/domain/sage-bridge/square-store"
import {
  getSageBridgeSecret,
  readBoundedSageBridgeBody,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  isSageSquareWriterOperation,
  hydrateLegacySageSquarePaymentScopes,
  sageSquareOrganizationId,
  sageSquarePaymentResultSchema,
  sageSquareTestOperationIds,
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
  // With writes off, only operations listed for a controlled test may report.
  const writesEnabled = sageSquareWritesEnabled(env)
  const testOperationIds = writesEnabled ? [] : sageSquareTestOperationIds(env)
  if (!writesEnabled && testOperationIds.length === 0) {
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
  if (!writesEnabled && !testOperationIds.includes(result.operationId)) {
    return Response.json(
      { error: "Sage Square payment writes are disabled" },
      { status: 503 }
    )
  }
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
  const now = new Date().toISOString()
  const claim = { operationId: result.operationId, claimToken: result.claimToken, now }
  const conflict = (): Response =>
    Response.json(
      { error: "Sage payment claim is missing, stale, or already completed" },
      { status: 409 }
    )

  // Alerts the people chosen for Square payment problems that a fee failed in Sage.
  async function notifyFailure(failed: {
    readonly id: string
    readonly operationType: string
    readonly squarePaymentId: string
    readonly organizationId: string | null
    readonly projectId: string | null
    readonly sageInvoiceNumber: string
  }, error: string): Promise<void> {
    await hydrateLegacySageSquarePaymentScopes(env, failed.squarePaymentId)
    const receipt = await db
      .select({
        id: sageSquarePaymentOperations.id,
        organizationId: sageSquarePaymentOperations.organizationId,
        projectId: sageSquarePaymentOperations.projectId,
      })
      .from(sageSquarePaymentOperations)
      .where(
        and(
          eq(sageSquarePaymentOperations.squarePaymentId, failed.squarePaymentId),
          eq(sageSquarePaymentOperations.operationType, "post_square_receipt")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const organizationId =
      receipt?.organizationId ?? failed.organizationId ?? sageSquareOrganizationId(env)
    const projectId = receipt?.projectId ?? failed.projectId ?? null
    if (!organizationId) return
    await notifySageSquareException(
      env,
      { organizationId, projectId, receiptOperationId: receipt?.id },
      failed.id,
      "Square payment could not be posted to Sage",
      `${failed.operationType} failed for Sage invoice ${failed.sageInvoiceNumber}: ${error}`
    )
  }

  // The claim is gone. If only because Square flagged the payment while the
  // writer held it, keep what Sage did on the flagged row (its record, or its
  // error plus the usual failure alert) and answer 2xx so the writer carries
  // on with its run; otherwise 409 as before.
  async function stale(): Promise<Response> {
    if (result.outcome === "failed") {
      const flagged = await recordFailureOnFlaggedSageSquareOperation(db, { ...claim, error: result.error })
      if (!flagged) return conflict()
      await notifyFailure(flagged, result.error)
      return Response.json({ success: true, status: "attention" }, { status: 202 })
    }
    const kept = await recordResultOnFlaggedSageSquareOperation(db, {
      ...claim,
      sageRecordId: result.sageRecordId,
      sageRecordNumber: result.sageRecordNumber,
    })
    return kept ? Response.json({ success: true, status: "attention" }, { status: 202 }) : conflict()
  }

  if (!operation) return stale()
  if (!isSageSquareWriterOperation(operation.operationType)) {
    return Response.json(
      { error: "Only Square processing-fee operations may use this writer" },
      { status: 409 }
    )
  }
  if (result.outcome === "failed") {
    // Compare-and-set on the claim: a repeated or stale result changes nothing and alerts no one.
    const recorded = await finishSageSquareFeeOperation(db, {
      ...claim,
      event: "fail",
      sageRecordId: null,
      sageRecordNumber: null,
      errorMessage: result.error,
    })
    if (!recorded) return stale()
    await notifyFailure(operation, result.error)
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }
  if (result.outcome === "already_in_sage") {
    // Nothing was written; the matching Sage entry is recorded for audit.
    const recorded = await finishSageSquareFeeOperation(db, {
      ...claim,
      event: "found_in_sage",
      sageRecordId: result.sageRecordId,
      sageRecordNumber: result.sageRecordNumber,
      errorMessage: result.matchReason,
    })
    if (!recorded) return stale()
    return Response.json({ success: true, status: "already_in_sage" })
  }
  const recorded = await finishSageSquareFeeOperation(db, {
    ...claim,
    event: "succeed",
    sageRecordId: result.sageRecordId,
    sageRecordNumber: result.sageRecordNumber,
    errorMessage: null,
  })
  if (!recorded) return stale()
  return Response.json({ success: true, status: "succeeded" })
}
