import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { estimateCanBeEdited, isEstimateStatus } from "@/lib/financials/estimate-ledger"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { projectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

export type CompassDb = ReturnType<typeof getDb>

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
    await db
      .update(projectEstimates)
      .set({
        foxitStatus: "not_started",
        foxitEnvelopeId: null,
        foxitEmbeddedSessionUrl: null,
        foxitPreparedSourceHash: null,
        foxitPreparedAt: null,
      })
      .where(eq(projectEstimates.id, estimateId))
      .run()
  }
  return estimate
}

