import { and, eq, notExists, type SQL } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectDuplicateDecisions,
  projectRegistryRemovals,
  projectRouteAliases,
  projects,
} from "@/db/schema"

/**
 * The project registry hides three kinds of rows: a project merged into
 * another (it has a route alias), a project removed from the registry, and
 * the removed side of a merged duplicate pair. Every project list that
 * should match the registry uses this one condition on `projects`.
 */
export function activeRegistryProject(db: ReturnType<typeof getDb>): SQL {
  const condition = and(
    notExists(
      db
        .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
        .from(projectRouteAliases)
        .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
    ),
    notExists(
      db
        .select({ projectId: projectRegistryRemovals.projectId })
        .from(projectRegistryRemovals)
        .where(eq(projectRegistryRemovals.projectId, projects.id)),
    ),
    notExists(
      db
        .select({ removedProjectId: projectDuplicateDecisions.removedProjectId })
        .from(projectDuplicateDecisions)
        .where(
          and(
            eq(projectDuplicateDecisions.status, "merged"),
            eq(projectDuplicateDecisions.removedProjectId, projects.id),
          ),
        ),
    ),
  )
  // `and` only returns undefined when given no conditions.
  if (!condition) throw new Error("registry visibility condition is empty")
  return condition
}
