import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { actionFailure, type ActionFailure } from "@/lib/action-result"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canFeature } from "@/lib/permission-enforcement"
import type { Action } from "@/lib/permissions"
import { getProjectAccessRecord, type ProjectAccessRecord } from "@/lib/project-access"

/**
 * The one place a server action or API route resolves who is asking, for
 * which organization, and whether they may (architecture standard, section
 * 2). Failures come back as an `ActionFailure` the caller can return as is.
 */

export type Db = ReturnType<typeof getDb>

export type OrgContext = {
  readonly user: AuthUser
  readonly organizationId: string
  readonly db: Db
  readonly env: CloudflareEnv
}

export type ProjectContext = OrgContext & {
  readonly project: ProjectAccessRecord
}

export type ContextOptions = {
  /** Feature permission to require, such as "project-photos". */
  readonly feature?: string
  /** Defaults to "read", or "update" for mutations. */
  readonly action?: Action
  /** Writes are refused for the read-only demo account and company. */
  readonly mutation?: boolean
}

type ContextResult<T> = { readonly success: true; readonly data: T } | ActionFailure

/** Messages existing actions and the UI already recognize. */
export const CONTEXT_ERRORS = {
  unauthorized: "Unauthorized",
  noOrganization: "No active organization",
  noDatabase: "Database not available",
  demoReadOnly: "DEMO_READ_ONLY",
  projectNotFound: "Project not found",
} as const

function permissionDenied(user: AuthUser, feature: string, action: Action): string {
  return `Permission denied: ${user.role} cannot ${action} ${feature}`
}

export async function orgContext(options: ContextOptions = {}): Promise<ContextResult<OrgContext>> {
  const user = await getCurrentUser()
  if (!user) return actionFailure(CONTEXT_ERRORS.unauthorized)
  const organizationId = user.organizationId
  if (!organizationId) return actionFailure(CONTEXT_ERRORS.noOrganization)
  if (options.mutation && (isDemoUser(user.id) || isDemoOrg(organizationId))) {
    return actionFailure(CONTEXT_ERRORS.demoReadOnly)
  }
  if (options.feature) {
    const action = options.action ?? (options.mutation ? "update" : "read")
    if (!(await canFeature(user, options.feature, action))) {
      return actionFailure(permissionDenied(user, options.feature, action))
    }
  }
  const { env } = await getCloudflareContext()
  if (!env?.DB) return actionFailure(CONTEXT_ERRORS.noDatabase)
  return { success: true, data: { user, organizationId, db: getDb(env.DB), env } }
}

/**
 * Who may reach a project:
 * - "organization": the project belongs to the user's active organization
 *   (staff workspaces).
 * - "member": `getProjectAccessRecord` — organization staff with project
 *   scope, project members (including invited owners and vendors), and
 *   invited previews.
 * Required, so moving an action here keeps its existing rule.
 */
export type ProjectScope = "organization" | "member"

export type ProjectContextOptions = ContextOptions & { readonly scope: ProjectScope }

async function organizationProject(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<ProjectAccessRecord | null> {
  const project = await db
    .select({ id: projects.id, organizationId: projects.organizationId, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .get()
  return project ?? null
}

/** `orgContext` plus the project, read once. */
export async function projectContext(
  projectId: string,
  options: ProjectContextOptions,
): Promise<ContextResult<ProjectContext>> {
  const context = await orgContext(options)
  if (!context.success) return context
  const { db, user, organizationId } = context.data
  const project =
    options.scope === "organization"
      ? await organizationProject(db, organizationId, projectId)
      : await getProjectAccessRecord(db, user, projectId)
  if (!project) return actionFailure(CONTEXT_ERRORS.projectNotFound)
  return { success: true, data: { ...context.data, project } }
}
