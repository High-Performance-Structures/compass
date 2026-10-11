import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getProjectAccessRecord } from "@/lib/project-access"
import { resolveProjectRouteId } from "@/lib/project-route-id"

type Db = ReturnType<typeof getDb>

const PROJECT_PAGE = /^\/dashboard\/projects\/([^/?#]+)/

/** The project route segment of a dashboard page, if it is a project page. */
export function projectRouteSegment(currentPage: string): string | null {
  const segment = PROJECT_PAGE.exec(currentPage)?.[1]
  return segment && segment.length > 0 ? segment : null
}

export function currentProjectPrompt(project: {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}): string {
  const label = project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name
  return [
    "## Current project",
    `The user is viewing project ${label} (project ID: ${project.id}).`,
    'When they say "this job", "this project", "here", or ask about project records without naming another project, use this project.',
  ].join("\n")
}

/**
 * Tells Jarvis which project page the user is on, so requests like "this
 * job's latest daily logs" resolve. Only projects the user can access are
 * described; anything else yields no context.
 */
export async function resolveCurrentProjectContext(
  db: Db,
  user: AuthUser,
  currentPage: string
): Promise<string | null> {
  const segment = projectRouteSegment(currentPage)
  if (!segment) return null
  try {
    const projectId = await resolveProjectRouteId(segment)
    if (!projectId) return null
    const access = await getProjectAccessRecord(db, user, projectId)
    if (!access) return null
    const project = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, access.id))
      .get()
    if (!project) return null
    return currentProjectPrompt({
      id: access.id,
      projectNumber: access.projectNumber,
      name: project.name,
    })
  } catch {
    return null
  }
}
