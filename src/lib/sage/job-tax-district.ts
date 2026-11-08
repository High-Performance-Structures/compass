import "server-only"

import { and, eq, isNotNull } from "drizzle-orm"

import { projects } from "@/db/schema"
import { projectEstimateLines, projectEstimates, sageTaxEntities } from "@/db/schema-estimates"
import { recordActivityEvent } from "@/lib/activity-log"
import { insertSageClientProjectWriteOperation } from "@/lib/domain/sage-bridge/store"
import { sageClientProjectWritePayloadSchema } from "@/lib/sage/client-project-write"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import type { Db } from "@/lib/server/action-context"

/**
 * The Sage tax district an accepted estimate bills under: its default tax
 * entity, else the one entity its taxable lines share. Null when the estimate
 * has no taxable lines, mixes districts, or the entity isn't a Sage district.
 */
async function estimateSageTaxDistrict(
  db: Db,
  estimateId: string
): Promise<{ readonly number: number; readonly name: string } | null> {
  const estimate = await db
    .select({ defaultTaxEntityId: projectEstimates.defaultTaxEntityId })
    .from(projectEstimates)
    .where(eq(projectEstimates.id, estimateId))
    .get()
  if (!estimate) return null
  let entityId = estimate.defaultTaxEntityId
  if (!entityId) {
    const used = await db
      .selectDistinct({ taxEntityId: projectEstimateLines.taxEntityId })
      .from(projectEstimateLines)
      .where(and(
        eq(projectEstimateLines.estimateId, estimateId),
        eq(projectEstimateLines.taxable, true),
        isNotNull(projectEstimateLines.taxEntityId)
      ))
    if (used.length !== 1) return null
    entityId = used[0]?.taxEntityId ?? null
  }
  if (!entityId) return null
  const entity = await db
    .select({ sourceRecordId: sageTaxEntities.sourceRecordId, name: sageTaxEntities.name })
    .from(sageTaxEntities)
    .where(eq(sageTaxEntities.id, entityId))
    .get()
  const number = Number(entity?.sourceRecordId)
  if (!entity || !Number.isInteger(number) || number < 1) return null
  return { number, name: entity.name.slice(0, 100) }
}

/**
 * Queues the Sage job's tax district once its accepted estimate is in Sage, so
 * Progress Billing taxes the job. Does nothing for an unlinked job or an
 * estimate without one district; a repeat for the same district is ignored.
 */
export async function queueSageJobTaxDistrict(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly estimateId: string
    readonly requestedByUserId: string | null
    readonly now: string
  }
): Promise<boolean> {
  const project = await db
    .select({ sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
    .get()
  if (!project?.sageJobId || !project.sageJobNumber) return false
  const district = await estimateSageTaxDistrict(db, input.estimateId)
  if (!district) return false
  const payload = {
    operationType: "set_job_tax_district",
    company: "High Performance Structures Inc",
    job: { compassProjectId: input.projectId, sageJobId: project.sageJobId, sageJobNumber: project.sageJobNumber },
    taxDistrict: district,
  } as const
  await insertSageClientProjectWriteOperation(db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    customerId: null,
    projectId: input.projectId,
    requestedByUserId: input.requestedByUserId,
    operationType: payload.operationType,
    idempotencyKey: `job-tax-district:${input.projectId}:${district.number}`,
    payloadJson: JSON.stringify(payload),
    status: "queued",
    requestedAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing()
  return true
}

/** Puts the writer's answer for a job tax district on the project's Activity, so a refusal is seen. */
export async function recordSageJobTaxDistrictResult(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly operationId: string
    readonly requestedByUserId: string | null
    readonly payloadJson: string
    readonly error: string | null
    readonly now: string
  }
): Promise<void> {
  const actor = await sageExportActor(db, input.requestedByUserId)
  if (!actor) return
  const parsed = sageClientProjectWritePayloadSchema.safeParse(safeJson(input.payloadJson))
  const district = parsed.success && parsed.data.operationType === "set_job_tax_district"
    ? parsed.data.taxDistrict.name
    : "the estimate's tax district"
  await recordActivityEvent({
    db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    actor,
    category: "financial",
    action: input.error ? "sage_job_tax_district_failed" : "sage_job_tax_district_set",
    entityType: "sage_client_project_write",
    entityId: input.operationId,
    summary: input.error
      ? `Sage job tax district not set to ${district}: ${input.error}`
      : `Sage job tax district set to ${district}.`,
    metadata: { district },
    createdAt: input.now,
  })
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
