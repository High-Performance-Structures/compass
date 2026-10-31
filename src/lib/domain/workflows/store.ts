/**
 * The only code that writes job workflow checklist ticks
 * (project_workflow_checks; architecture standard, section 1). No auth logic
 * here; callers resolve project access first.
 */
import { and, eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { chunkD1Rows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type NewWorkflowCheck = typeof projectWorkflowChecks.$inferInsert

/** Ticks items in one batch, leaving any already-ticked item as it was. */
export async function insertWorkflowChecksIfAbsent(
  db: Db,
  rows: readonly NewWorkflowCheck[]
): Promise<void> {
  const [first, ...rest] = chunkD1Rows(rows).map((chunk) =>
    db.insert(projectWorkflowChecks).values(chunk).onConflictDoNothing()
  )
  if (!first) return
  await db.batch([first, ...rest])
}

/** A single tick for a caller's `db.batch`, ignoring an existing tick. */
export function workflowCheckInsertStatement(
  db: Db,
  row: NewWorkflowCheck
): BatchItem<"sqlite"> {
  return db.insert(projectWorkflowChecks).values(row).onConflictDoNothing()
}

/** Unticks one item on one project, for a caller's `db.batch`. */
export function workflowCheckDeleteStatement(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly itemKey: string
  }
): BatchItem<"sqlite"> {
  return db
    .delete(projectWorkflowChecks)
    .where(
      and(
        eq(projectWorkflowChecks.projectId, input.projectId),
        eq(projectWorkflowChecks.organizationId, input.organizationId),
        eq(projectWorkflowChecks.itemKey, input.itemKey)
      )
    )
}
