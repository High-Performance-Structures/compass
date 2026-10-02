"use server"

import { and, eq, exists, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectOperations,
  projectProfileAuditEvents,
  projects,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { isGooglePhaseHandoffAwaitingClientReview } from "@/lib/sage/project-handoff-review"

type ReviewProjectHandoffClientResult =
  | { readonly success: true; readonly updatedAt: string }
  | { readonly success: false; readonly error: string }

function reviewedClientName(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ")
  return cleaned.length > 0 ? cleaned : null
}

export async function reviewProjectHandoffClient(
  projectId: string,
  operationId: string,
  expectedUpdatedAt: string,
  clientNameInput: string,
): Promise<ReviewProjectHandoffClientResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "Demo projects are read-only." }
    }
    await requireFeaturePermission(user, "sage-sync", "update")
    const organizationId = requireOrg(user)
    const clientName = reviewedClientName(clientNameInput)
    if (!clientName) {
      return { success: false, error: "Enter the Sage client/company." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const operation = await db
      .select({
        id: projectOperations.id,
        sourceSystem: projectOperations.sourceSystem,
        sourceRecordType: projectOperations.sourceRecordType,
        status: projectOperations.status,
        syncDirection: projectOperations.syncDirection,
        syncStatus: projectOperations.syncStatus,
        sageWriteStatus: projectOperations.sageWriteStatus,
        companyName: projectOperations.companyName,
        updatedAt: projectOperations.updatedAt,
        projectClientName: projects.clientName,
      })
      .from(projectOperations)
      .innerJoin(projects, eq(projects.id, projectOperations.projectId))
      .where(
        and(
          eq(projectOperations.id, operationId),
          eq(projectOperations.projectId, projectId),
          eq(projects.organizationId, organizationId),
        ),
      )
      .limit(1)
      .get()

    if (!operation) {
      return { success: false, error: "Sage project handoff not found." }
    }
    if (!isGooglePhaseHandoffAwaitingClientReview(operation)) {
      return {
        success: false,
        error: "This item is not awaiting Google phase client review.",
      }
    }
    if (operation.updatedAt !== expectedUpdatedAt) {
      return {
        success: false,
        error: "This handoff changed while you were reviewing it. Refresh and try again.",
      }
    }

    const now = new Date().toISOString()
    const guardedPendingReview = db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, operationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceSystem, "google_project_manager"),
          eq(projectOperations.sourceRecordType, "sage_project_handoff"),
          eq(projectOperations.status, "needs_review"),
          eq(projectOperations.syncDirection, "write"),
          eq(projectOperations.sageWriteStatus, "not_ready"),
          eq(projectOperations.syncStatus, "needs_review"),
          eq(projectOperations.updatedAt, expectedUpdatedAt),
        ),
      )
    const beforeJson = JSON.stringify({
      operationCompanyName: operation.companyName,
      projectClientName: operation.projectClientName,
      sageWriteStatus: operation.sageWriteStatus,
      syncStatus: operation.syncStatus,
      status: operation.status,
    })
    const afterJson = JSON.stringify({
      operationCompanyName: clientName,
      projectClientName: clientName,
      sageWriteStatus: "needs_review",
      syncStatus: "pending_sage",
      status: "open",
    })
    const reviewedDescription =
      "Client/company confirmed by a developer; ready for the Sage queue."

    // D1 batches are transactional and ordered. Keep the guarded operation
    // update last so every earlier mutation can require the untouched review
    // version; a concurrent reviewer then makes all three statements no-ops.
    const results = await db.batch([
      db
        .update(projects)
        .set({ clientName, updatedAt: now })
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, organizationId),
            exists(guardedPendingReview),
          ),
        ),
      db.insert(projectProfileAuditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            organizationId: projects.organizationId,
            projectId: projects.id,
            actorUserId: sql<string>`${user.id}`.as("actorUserId"),
            eventType: sql<string>`'project.sage_handoff_client_reviewed'`.as(
              "eventType",
            ),
            entityType: sql<string>`'project_operation'`.as("entityType"),
            entityId: sql<string>`${operationId}`.as("entityId"),
            beforeJson: sql<string>`${beforeJson}`.as("beforeJson"),
            afterJson: sql<string>`${afterJson}`.as("afterJson"),
            createdAt: sql<string>`${now}`.as("createdAt"),
          })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              eq(projects.organizationId, organizationId),
              exists(guardedPendingReview),
            ),
          ),
      ),
      db
        .update(projectOperations)
        .set({
          companyName: clientName,
          description: reviewedDescription,
          status: "open",
          sageWriteStatus: "needs_review",
          syncStatus: "pending_sage",
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.id, operationId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceSystem, "google_project_manager"),
            eq(projectOperations.sourceRecordType, "sage_project_handoff"),
            eq(projectOperations.status, "needs_review"),
            eq(projectOperations.syncDirection, "write"),
            eq(projectOperations.sageWriteStatus, "not_ready"),
            eq(projectOperations.syncStatus, "needs_review"),
            eq(projectOperations.updatedAt, expectedUpdatedAt),
          ),
        ),
    ])
    const operationUpdate = results[2]
    if (!operationUpdate || operationUpdate.meta.changes !== 1) {
      return {
        success: false,
        error: "This handoff changed while you were reviewing it. Refresh and try again.",
      }
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, updatedAt: now }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to review the Sage project handoff.",
    }
  }
}
