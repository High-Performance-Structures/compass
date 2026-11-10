/**
 * Scheduled: a "Place long-lead order" to-do for each selection whose
 * order-by date (due date − lead time) is within the company's warning
 * window or already past, and that is not ordered or installed yet. Uses the
 * selection to-dos (selection-todos.ts), so it goes to the project manager
 * named on the job like the other selection to-dos. One to-do per selection
 * and order-by date: a finished one is not made again unless the order-by
 * date moves (new lead time or due date).
 */
import { and, eq, gt, notInArray } from "drizzle-orm"

import { organizationMembers, projectFinishSelections, projects } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"
import { formatDate } from "@/lib/format"
import type { Db } from "@/lib/server/action-context"

import { loadLeadTimeContext, loadSelectionLeadTimeWarnings } from "./lead-time-read"
import { leadTimeLabel } from "./lead-time-rules"
import { ensureSelectionTodo } from "./selection-todos"

/** Selection statuses that can still need ordering; the rules skip the rest too. */
const SETTLED: readonly ("ordered" | "installed" | "deferred" | "unavailable")[] = ["ordered", "installed", "deferred", "unavailable"]

/** The company's jobs with at least one unsettled selection whose choice has a lead time. */
async function projectsWithLeadTimes(db: Db, organizationId: string): Promise<readonly string[]> {
  const rows = await db
    .selectDistinct({ projectId: projectSelectionChoices.projectId })
    .from(projectSelectionChoices)
    .innerJoin(projectFinishSelections, eq(projectFinishSelections.id, projectSelectionChoices.selectionId))
    .innerJoin(projects, eq(projects.id, projectSelectionChoices.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        gt(projectSelectionChoices.leadTimeDays, 0),
        notInArray(projectFinishSelections.status, [...SETTLED]),
      ),
    )
  return rows.map((row) => row.projectId)
}

export async function createLeadTimeTodos(
  db: Db,
  now: Date = new Date(),
): Promise<{ readonly companies: number; readonly projects: number; readonly created: number }> {
  const orgs = await db.selectDistinct({ organizationId: organizationMembers.organizationId }).from(organizationMembers)
  const stamp = now.toISOString()
  let projectCount = 0
  let created = 0
  for (const { organizationId } of orgs) {
    const projectIds = await projectsWithLeadTimes(db, organizationId)
    // Jobs one at a time keeps each run's reads small.
    for (const projectId of projectIds) {
      try {
        const context = await loadLeadTimeContext(db, { projectId, organizationId, now })
        const warnings = await loadSelectionLeadTimeWarnings(db, projectId, context)
        if (warnings.length > 0) projectCount += 1
        for (const warning of warnings) {
          const needed = formatDate(warning.neededByDate, "medium")
          const orderBy = formatDate(warning.orderByDate, "medium")
          const id = await ensureSelectionTodo(db, {
            projectId,
            selectionId: warning.selectionId,
            selectionName: warning.selectionName,
            step: "order_lead_time",
            actorId: null,
            now: stamp,
            onceKey: warning.orderByDate,
            dueDate: warning.orderByDate,
            description:
              warning.level === "late"
                ? `${leadTimeLabel(warning.leadTimeDays)}: the order-by date (${orderBy}) has passed, so it may not arrive by ${needed}. Order it now or adjust the schedule.`
                : `${leadTimeLabel(warning.leadTimeDays)}: order by ${orderBy} so it arrives by ${needed}.`,
          })
          if (id) created += 1
        }
      } catch (error) {
        // One job's failure must not stop the others.
        console.error("[selections] lead-time to-dos failed", { projectId, error: error instanceof Error ? error.name : "unknown" })
      }
    }
  }
  return { companies: orgs.length, projects: projectCount, created }
}
