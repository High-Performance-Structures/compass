"use server"

import { and, eq, exists } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projects } from "@/db/schema"
import { isDemoUser } from "@/lib/demo"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { updateProjectsStatement } from "@/lib/domain/project/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { orgContext } from "@/lib/server/action-context"
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
    // Not a "mutation" context: the demo keeps its own message below.
    const context = await orgContext({ feature: "sage-sync", action: "update" })
    if (!context.success) throw new Error(context.error)
    const { db, user, organizationId } = context.data
    if (isDemoUser(user.id)) {
      return { success: false, error: "Demo projects are read-only." }
    }
    const clientName = reviewedClientName(clientNameInput)
    if (!clientName) {
      return { success: false, error: "Enter the Sage client/company." }
    }

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
      updateProjectsStatement(
        db,
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          exists(guardedPendingReview),
        ),
        { clientName, updatedAt: now },
      ),
      recordProjectAudit(
        db,
        {
          organizationId,
          projectId,
          actorUserId: user.id,
          eventType: "project.sage_handoff_client_reviewed",
          entityType: "project_operation",
          entityId: operationId,
          beforeJson,
          afterJson,
          createdAt: now,
        },
        { onlyIf: exists(guardedPendingReview) },
      ),
      operationUpdateQuery(
        db,
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
        {
          companyName: clientName,
          description: reviewedDescription,
          status: "open",
          sageWriteStatus: "needs_review",
          syncStatus: "pending_sage",
          updatedAt: now,
        },
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
