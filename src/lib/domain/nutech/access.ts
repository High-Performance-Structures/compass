import { and, eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { projectDepartment } from "@/lib/project-branding"
import { orgContext, type Db, type OrgContext } from "@/lib/server/action-context"

/**
 * Nu-Tech's own access rule, on top of the shared action context: the work
 * lives on N jobs of the user's own company. Each action keeps its own
 * message for a job outside Nu-Tech.
 */

export type NuTechProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly clientName: string | null
  readonly address: string | null
  readonly googleDriveFolderId: string | null
  readonly deliveryMethod: (typeof projects.$inferSelect)["deliveryMethod"]
  readonly jobStatusId: string
}

/**
 * The shared context (user, company, database) for Nu-Tech actions that
 * report failures by throwing; the context's own messages are kept. Each
 * action then checks demo access and its feature permission in the order it
 * always has.
 */
export async function nuTechOrgContext(): Promise<OrgContext> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  return context.data
}

/** A project of the company, or null. */
export async function readNuTechProject(db: Db, organizationId: string, projectId: string): Promise<NuTechProject | null> {
  const project = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      clientName: projects.clientName,
      address: projects.address,
      googleDriveFolderId: projects.googleDriveFolderId,
      deliveryMethod: projects.deliveryMethod,
      jobStatusId: projects.jobStatusId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .get()
  return project ?? null
}

/** Whether a project is a Nu-Tech (N department) job. */
export function isNuTechJob(project: { readonly id: string; readonly projectNumber: string | null }): boolean {
  return projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) === "N"
}
