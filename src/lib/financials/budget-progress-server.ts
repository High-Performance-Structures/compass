import { and, eq } from "drizzle-orm"

import { projectBudgetLines } from "@/db/schema"
import {
  isBudgetProjection,
  latestProgressApplication,
  type ProgressLine,
} from "@/lib/financials/budget-progress-overlay"
import type { ProjectBudgetApplicationItem } from "@/lib/financials/project-budget-types"
import type { ProjectBudgetAudience } from "@/lib/project-budget-audience"
import type { Db } from "@/lib/server/action-context"

/**
 * Completion for the current contract budget view: the latest pay
 * application's lines (any revision, Compass or imported), limited to what
 * the audience may see. `applications` are newest first and already limited
 * to the audience. Null when the selected row is not the current budget view.
 */
export async function loadBudgetViewProgress(
  db: Db,
  input: {
    readonly projectId: string
    readonly applications: readonly ProjectBudgetApplicationItem[]
    readonly currentApplication: ProjectBudgetApplicationItem | null
    readonly audience: ProjectBudgetAudience
  }
): Promise<readonly ProgressLine[] | null> {
  const current = input.currentApplication
  if (!current || !isBudgetProjection(current) || current.status !== "budget_current") return null
  const source = latestProgressApplication(input.applications)
  if (!source) return null
  return db
    .select({
      costCode: projectBudgetLines.costCode,
      assemblyKey: projectBudgetLines.assemblyKey,
      priorCosts: projectBudgetLines.priorCosts,
      currentCosts: projectBudgetLines.currentCosts,
      totalCosts: projectBudgetLines.totalCosts,
      retainageHeld: projectBudgetLines.retainageHeld,
    })
    .from(projectBudgetLines)
    .where(
      and(
        eq(projectBudgetLines.projectId, input.projectId),
        eq(projectBudgetLines.applicationId, source.id),
        ...(input.audience === "owner" ? [eq(projectBudgetLines.ownerVisible, true)] : [])
      )
    )
}
