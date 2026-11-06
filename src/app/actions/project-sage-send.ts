"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { customers, projects } from "@/db/schema"
import { sageClientDirectoryEntries, sageClientProjectWriteOperations } from "@/db/schema-sage"
import { actionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import { sageIdentityLinkStatement } from "@/lib/domain/contacts/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import {
  isSageClientNameMatchError,
  payloadWithSageClient,
  projectSageStatus,
  sageClientNameKey,
  type ProjectSageStatus,
  type SageClientChoice,
} from "@/lib/domain/sage-bridge/project-send-rules"
import { requeueFailedSageClientProjectWriteStatement } from "@/lib/domain/sage-bridge/store"
import { sageClientProjectWritesEnabled } from "@/lib/sage/client-project-write"
import { sameSageRecordId } from "@/lib/sage/record-id"
import { projectContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type SendResult = { readonly success: true } | { readonly success: false; readonly error: string }

/** Office staff of the company that owns the job (not owners, vendors, or the demo company). */
function isOfficeStaff(user: AuthUser): boolean {
  return user.organizationType === "internal" && isInternalStaffRole(user.role)
}

async function loadWrite(db: Db, organizationId: string, projectId: string) {
  return db.select({
    id: sageClientProjectWriteOperations.id,
    customerId: sageClientProjectWriteOperations.customerId,
    status: sageClientProjectWriteOperations.status,
    errorMessage: sageClientProjectWriteOperations.errorMessage,
    payloadJson: sageClientProjectWriteOperations.payloadJson,
  }).from(sageClientProjectWriteOperations).where(and(
    eq(sageClientProjectWriteOperations.organizationId, organizationId),
    eq(sageClientProjectWriteOperations.projectId, projectId),
    eq(sageClientProjectWriteOperations.operationType, "ensure_client_and_job"),
  )).limit(1).get()
}

async function sageClientChoices(db: Db, organizationId: string, clientName: string): Promise<readonly SageClientChoice[]> {
  const key = sageClientNameKey(clientName)
  if (!key) return []
  const rows = await db.select({
    sageRecordId: sageClientDirectoryEntries.sageRecordId,
    sageClientNumber: sageClientDirectoryEntries.sageClientNumber,
    name: sageClientDirectoryEntries.name,
    email: sageClientDirectoryEntries.email,
  }).from(sageClientDirectoryEntries).where(and(
    eq(sageClientDirectoryEntries.organizationId, organizationId),
    sql`lower(trim(${sageClientDirectoryEntries.name})) = ${key}`,
  )).limit(10)
  return rows.filter((row) => sageClientNameKey(row.name) === key)
}

/** The Overview's Sage badge, or null when the viewer isn't office staff or Sage isn't connected. */
export async function getProjectSageStatus(projectId: string): Promise<ProjectSageStatus | null> {
  const context = await projectContext(projectId, { scope: "organization", feature: "project-hub" })
  if (!context.success || !context.data.organizationId) return null
  const { db, env, user, organizationId } = context.data
  if (!isOfficeStaff(user) || !sageClientProjectWritesEnabled(env)) return null
  const [project, write] = await Promise.all([
    db.select({
      sageJobNumber: projects.sageJobNumber,
      sageJobStatusName: projects.sageJobStatusName,
    }).from(projects).where(eq(projects.id, projectId)).get(),
    loadWrite(db, organizationId, projectId),
  ])
  if (!project) return null
  const customer = write?.customerId
    ? await db.select({ name: customers.name }).from(customers)
      .where(and(eq(customers.id, write.customerId), eq(customers.organizationId, organizationId))).get()
    : null
  const clientName = customer?.name ?? null
  const clientChoices = write && clientName && isSageClientNameMatchError(write.errorMessage)
    ? await sageClientChoices(db, organizationId, clientName)
    : []
  return projectSageStatus({
    sageJobNumber: project.sageJobNumber,
    sageJobStatusName: project.sageJobStatusName,
    write: write ?? null,
    clientName,
    clientChoices,
  })
}

/**
 * Sends a job whose Sage write failed back to the Windows writer. When the
 * writer stopped on a same-name Sage client, `sageClient` is the client staff
 * confirmed; it is linked to the Compass client in the same step.
 */
export async function sendProjectToSage(
  projectId: string,
  sageClient: { readonly sageRecordId: string; readonly sageClientNumber: string } | null = null,
): Promise<SendResult> {
  const context = await projectContext(projectId, {
    scope: "organization", feature: "project-hub", action: "update", mutation: true,
  })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!isOfficeStaff(user)) return actionFailure("Only office staff can send jobs to Sage.")
  if (!sageClientProjectWritesEnabled(env)) return actionFailure("Sage isn't connected for this company.")

  const project = await db.select({ sageJobNumber: projects.sageJobNumber })
    .from(projects).where(eq(projects.id, projectId)).get()
  if (project?.sageJobNumber) return actionFailure("This job is already linked to Sage.")
  const write = await loadWrite(db, organizationId, projectId)
  if (!write) {
    return actionFailure("Compass never created this job in Sage, so it can't be sent from here. It may already be in Sage under another name.")
  }
  if (write.status === "queued" || write.status === "running") return { success: true }
  if (write.status !== "failed") return actionFailure("This job has nothing waiting to send to Sage.")

  const customer = write.customerId
    ? await db.select({
      id: customers.id, name: customers.name,
      sageClientId: customers.sageClientId, sageClientNumber: customers.sageClientNumber,
    }).from(customers).where(and(eq(customers.id, write.customerId), eq(customers.organizationId, organizationId))).get()
    : null

  let link: { readonly sageClientId: string; readonly sageClientNumber: string } | null = null
  let linkCustomer = false
  if (sageClient) {
    if (!customer) return actionFailure("This job's Compass client wasn't found.")
    // Only a client the writer flagged as a same-name match, read from the Sage directory copy.
    const choices = isSageClientNameMatchError(write.errorMessage)
      ? await sageClientChoices(db, organizationId, customer.name) : []
    const chosen = choices.find((choice) =>
      sameSageRecordId(choice.sageRecordId, sageClient.sageRecordId) &&
      choice.sageClientNumber === sageClient.sageClientNumber)
    if (!chosen) return actionFailure("That Sage client isn't a match for this job's client. Refresh and try again.")
    if (customer.sageClientId && !sameSageRecordId(customer.sageClientId, chosen.sageRecordId)) {
      return actionFailure(`${customer.name} is already linked to a different Sage client.`)
    }
    link = { sageClientId: chosen.sageRecordId.toUpperCase(), sageClientNumber: chosen.sageClientNumber }
    linkCustomer = !customer.sageClientId
  } else if (customer?.sageClientId && customer.sageClientNumber) {
    // Linked in Compass since the failed send; the writer then uses that exact client.
    link = { sageClientId: customer.sageClientId, sageClientNumber: customer.sageClientNumber }
  }

  const payloadJson = payloadWithSageClient(write.payloadJson, link)
  if (!payloadJson) return actionFailure("This job's saved Sage details can't be read. Ask a developer to check it.")

  const now = new Date().toISOString()
  const statements = [
    requeueFailedSageClientProjectWriteStatement(env.DB, { operationId: write.id, organizationId, payloadJson, now }),
  ]
  if (linkCustomer && customer && link) {
    // Links only while this send's requeue above took effect, in the same batch.
    const guard = `EXISTS (SELECT 1 FROM sage_client_project_write_operations
      WHERE id = ? AND organization_id = ? AND status = 'queued' AND updated_at = ?)`
    statements.push(sageIdentityLinkStatement(env.DB, "client_company", guard, [
      link.sageClientId, link.sageClientNumber, customer.id, organizationId, link.sageClientNumber,
      write.id, organizationId, now,
    ]))
  }
  const results = await env.DB.batch(statements)
  if (results[0]?.meta.changes !== 1) return actionFailure("This job changed while you were sending it. Refresh and try again.")

  await recordProjectAudit(db, {
    organizationId,
    projectId,
    actorUserId: user.id,
    eventType: "project.sage_job_resent",
    entityType: "sage_client_project_write",
    entityId: write.id,
    beforeJson: JSON.stringify({ status: write.status, errorMessage: write.errorMessage }),
    afterJson: JSON.stringify({ status: "queued", sageClientNumber: link?.sageClientNumber ?? null, linkedClient: linkCustomer }),
    createdAt: now,
  })
  revalidatePath(`/dashboard/projects/${projectId}`)
  return { success: true }
}
