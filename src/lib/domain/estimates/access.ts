import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { estimateCanBeEdited, isEstimateStatus } from "@/lib/domain/estimates/rules"
import { updateEstimates } from "@/lib/domain/estimates/store"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { projectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

export type CompassDb = Db

export type EstimateAccess = {
  readonly db: CompassDb
  readonly rawDb: D1Database
  readonly user: AuthUser
  readonly projectNumber: string | null
  readonly projectName: string
  readonly projectAddress: string | null
  readonly projectMailingAddress: string | null
  readonly projectClientName: string | null
  readonly organizationId: string | null
  readonly department: ProjectDepartment
  readonly canEdit: boolean
}

/** What loading an estimate workspace needs once access has been decided. */
export type EstimateWorkspaceSource = Omit<EstimateAccess, "user" | "canEdit">

/**
 * Project context for the paper trail's record copy. The caller must already
 * have verified a single-record pass; no user is involved.
 */
export async function estimateSourceForRecordCopy(
  env: CloudflareEnv,
  projectId: string
): Promise<EstimateWorkspaceSource | null> {
  const db = getDb(env.DB)
  const [project] = await db
    .select({
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      mailingAddress: projects.mailingAddress,
      clientName: projects.clientName,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return null
  return {
    db,
    rawDb: env.DB,
    projectNumber: project.projectNumber,
    projectName: project.name,
    projectAddress: project.address,
    projectMailingAddress: project.mailingAddress,
    projectClientName: project.clientName,
    organizationId: project.organizationId,
    department: projectDepartment({ projectId, projectNumber: project.projectNumber }),
  }
}

/**
 * The estimate access rule:
 * - the "budget" role permission (read, or update for edits);
 * - project access through `assertProjectAccess` (the "member" rule);
 * - edits only by internal staff.
 * It does not use `orgContext`, which also requires an active organization:
 * project members (owners, vendors) without one reach estimates today, and
 * keeping that access unchanged takes priority. Throws with the same
 * messages as before; callers catch and return them.
 */
export async function estimateAccess(
  projectId: string,
  update: boolean
): Promise<EstimateAccess> {
  const user = await requireAuth()
  requirePermission(user, "budget", update ? "update" : "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await assertProjectAccess(db, user, projectId)
  const projectRows = await db
    .select({
      name: projects.name,
      address: projects.address,
      mailingAddress: projects.mailingAddress,
      clientName: projects.clientName,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const project = projectRows[0]
  if (!project) throw new Error("Project not found")
  const canEdit = update && isInternalStaffRole(user.role)
  if (update && !canEdit) {
    throw new Error("Only authorized internal staff can edit estimates.")
  }
  return {
    db,
    rawDb: env.DB,
    user,
    projectNumber: access.projectNumber,
    projectName: project.name,
    projectAddress: project.address,
    projectMailingAddress: project.mailingAddress,
    projectClientName: project.clientName,
    organizationId: project.organizationId,
    department: projectDepartment({
      projectId,
      projectNumber: access.projectNumber,
    }),
    canEdit,
  }
}

export function revalidateEstimate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/estimate/compare`)
  revalidatePath(`/print/projects/${projectId}/estimate`)
  revalidatePath(`/print/projects/${projectId}/estimate/compare`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
}

/**
 * The estimate, when it may still be edited. An edit also cancels a
 * signature request that was being prepared, so the client never signs
 * figures that changed after preparation.
 */
export async function requireEditableEstimate(
  db: CompassDb,
  projectId: string,
  estimateId: string
): Promise<typeof projectEstimates.$inferSelect> {
  const rows = await db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.id, estimateId),
        eq(projectEstimates.projectId, projectId)
      )
    )
    .limit(1)
  const estimate = rows[0]
  if (!estimate || !isEstimateStatus(estimate.status)) {
    throw new Error("Estimate not found.")
  }
  if (!estimateCanBeEdited(estimate.status)) {
    throw new Error(
      "This estimate is locked. Create a revision instead of changing accepted contract values."
    )
  }
  if (estimate.foxitStatus === "preparing") {
    await updateEstimates(db, eq(projectEstimates.id, estimateId), {
      foxitStatus: "not_started",
      foxitEnvelopeId: null,
      foxitEmbeddedSessionUrl: null,
      foxitPreparedSourceHash: null,
      foxitPreparedAt: null,
    })
  }
  return estimate
}
