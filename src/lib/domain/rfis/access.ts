/**
 * Who may read or change a project's RFIs. Reads resolve the audience
 * viewer (the previewed owner or vendor in a staff preview), so they keep
 * that helper and only take the database from the shared action context.
 */
import { and, eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertAudiencePreviewWriteAllowed, requireProjectAudienceReadUser } from "@/lib/project-audience-request-server"
import { assertProjectAccess } from "@/lib/project-access"
import { orgContext, projectContext, type Db } from "@/lib/server/action-context"

export type RfiReadContext = {
  readonly db: Db
  /** The audience viewer: the previewed person in a staff preview. */
  readonly viewer: AuthUser
  readonly organizationId: string
}

/**
 * The viewer may read RFIs in this project: the "rfis" read permission, the
 * project in the viewer's organization, and project access.
 */
export async function rfiReadContext(projectId: string): Promise<RfiReadContext> {
  const viewer = await requireProjectAudienceReadUser(projectId)
  await requireFeaturePermission(viewer, "rfis", "read")
  const organizationId = requireOrg(viewer)

  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  const { db } = context.data

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  if (!existing[0]) throw new Error("Project not found")

  await assertProjectAccess(db, viewer, projectId)
  return { db, viewer, organizationId }
}

export type RfiWriteContext = {
  readonly db: Db
  readonly user: AuthUser
  readonly orgId: string
  readonly projectNumber: string | null
}

/**
 * Staff writes: never from a preview, the "rfis" update permission, and the
 * project in the user's organization. RFI writes have never been refused for
 * the demo account, so this is not a `mutation` context.
 */
export async function rfiWriteContext(projectId: string): Promise<RfiWriteContext> {
  await assertAudiencePreviewWriteAllowed()
  const context = await projectContext(projectId, { scope: "organization", feature: "rfis", action: "update" })
  if (!context.success) throw new Error(context.error)
  const { db, user, organizationId, project } = context.data
  if (!organizationId) throw new Error("No active organization")
  return { db, user, orgId: organizationId, projectNumber: project.projectNumber }
}
