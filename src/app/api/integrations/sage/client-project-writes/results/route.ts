import { and, eq, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { sageClientWriteResultCustomerStatement, updateVendorById } from "@/lib/domain/contacts/store"
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
import { recordSageAddOutcome } from "@/lib/sage/directory-add-service"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import { recordSageJobTaxDistrictResult } from "@/lib/sage/job-tax-district"

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
    await recordTaxDistrictResult(db, operation, result.error, now)
    await recordSageAddOutcome(db, {
      operationId: operation.id, organizationId: operation.organizationId, outcome: "failed",
      sageRecordId: null, sageRecordNumber: null, error: result.error, now,
    })
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }

  if ("vendor" in result) {
    if (operation.operationType !== "ensure_vendor") {
      return Response.json({ error: "A vendor result answered a non-vendor write" }, { status: 400 })
    }
    return recordVendorAdded(db, operation, result.vendor, now)
  }
  if (operation.operationType === "ensure_vendor") {
    return Response.json({ error: "The vendor write returned no vendor" }, { status: 400 })
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
      jobTypeNumber: result.job?.typeNumber || null,
      now,
    }),
  ]
  const customerStatementIndex = operation.customerId ? statements.length : null
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
        sageJobTypeNumber: result.job.typeNumber || null,
        now,
      })
    )
  }
  const results = await env.DB.batch(statements)
  if (customerStatementIndex !== null && results[customerStatementIndex]?.meta.changes === 0) {
    await recordClientOnDuplicateCustomer(db, operation, result.client, now)
  }
  await recordTaxDistrictResult(db, operation, null, now)
  await recordSageAddOutcome(db, {
    operationId: operation.id, organizationId: operation.organizationId, outcome: "succeeded",
    sageRecordId: result.client.id, sageRecordNumber: result.client.number, error: null, now,
  })
  return Response.json({ success: true, status: "succeeded" })
}

/**
 * An approved "Request add to Sage" vendor is in Sage: the write is finished
 * and the Compass vendor takes the Sage vendor's id and number, so Sage's
 * daily vendor list updates it instead of offering it as new.
 */
async function recordVendorAdded(
  db: ReturnType<typeof getDb>,
  operation: typeof sageClientProjectWriteOperations.$inferSelect,
  vendor: { readonly id: string; readonly number: string; readonly print1099Applied: boolean },
  now: string
): Promise<Response> {
  await updateSageClientProjectWriteOperations(
    db,
    { status: "succeeded", sageVendorId: vendor.id, sageVendorNumber: vendor.number, completedAt: now, updatedAt: now },
    eq(sageClientProjectWriteOperations.id, operation.id)
  )
  let linkError: string | null = null
  if (operation.vendorId) {
    const holder = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(
      eq(vendors.organizationId, operation.organizationId),
      or(eq(vendors.sageVendorNumber, vendor.number), sql`upper(${vendors.sageVendorId}) = upper(${vendor.id})`),
    )).get()
    if (holder && holder.id !== operation.vendorId) {
      linkError = `Sage vendor #${vendor.number} already belongs to ${holder.name} in Compass; merge the two vendors.`
    } else if (!holder) {
      await updateVendorById(db, { vendorId: operation.vendorId, values: { sageVendorId: vendor.id, sageVendorNumber: vendor.number, updatedAt: now } })
    }
  }
  await recordSageAddOutcome(db, {
    operationId: operation.id, organizationId: operation.organizationId, outcome: "succeeded",
    sageRecordId: vendor.id, sageRecordNumber: vendor.number,
    error: linkError ?? (vendor.print1099Applied ? null : "Sage added the vendor, but its 1099 box must be set in Sage by hand."),
    now,
  })
  return Response.json({ success: true, status: "succeeded" })
}

/**
 * The job was linked, but its Compass client wasn't: another Compass client
 * already holds this Sage client, so the two are duplicates. Says so in the
 * job's Activity (never fails the result).
 */
async function recordClientOnDuplicateCustomer(
  db: ReturnType<typeof getDb>,
  operation: typeof sageClientProjectWriteOperations.$inferSelect,
  client: { readonly id: string; readonly number: string },
  now: string
): Promise<void> {
  if (!operation.customerId || !operation.projectId) return
  try {
    const holders = await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(
      eq(customers.organizationId, operation.organizationId),
      or(eq(customers.sageClientNumber, client.number), sql`upper(${customers.sageClientId}) = upper(${client.id})`),
    ))
    const holder = holders.find((row) => row.id !== operation.customerId)
    const actor = await sageExportActor(db, operation.requestedByUserId)
    if (!holder || !actor) return
    const own = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, operation.customerId)).get()
    await recordActivityEvent({
      db,
      organizationId: operation.organizationId,
      projectId: operation.projectId,
      actor,
      category: "financial",
      action: "sage_client_on_duplicate_customer",
      entityType: "sage_client_project_write",
      entityId: operation.id,
      summary: `Linked to Sage, but Sage client #${client.number} already belongs to ${holder.name} in Compass, so ${own?.name ?? "this job's client"} wasn't linked to it. Merge the two Compass clients.`,
      metadata: { sageClientNumber: client.number, customerId: operation.customerId, holderCustomerId: holder.id },
      createdAt: now,
    })
  } catch (failure) {
    console.error("Sage duplicate-client activity could not be recorded", failure)
  }
}

async function recordTaxDistrictResult(
  db: ReturnType<typeof getDb>,
  operation: typeof sageClientProjectWriteOperations.$inferSelect,
  error: string | null,
  now: string
): Promise<void> {
  if (operation.operationType !== "set_job_tax_district" || !operation.projectId) return
  try {
    await recordSageJobTaxDistrictResult(db, {
      organizationId: operation.organizationId, projectId: operation.projectId, operationId: operation.id,
      requestedByUserId: operation.requestedByUserId, payloadJson: operation.payloadJson, error, now,
    })
  } catch (failure) {
    console.error("Sage job tax district activity could not be recorded", failure)
  }
}
