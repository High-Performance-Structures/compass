import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectBudgetApplications, projectBudgetLines, sageCostCodes } from "@/db/schema"
import { projectEstimateCostCodeCatalog, type ProjectEstimateCostCodeCatalogItem } from "@/lib/estimates/project-cost-code-catalog"

/** One company catalog for project coding; callers authorize project access first. */
export async function loadProjectCostCodeCatalog(
  db: ReturnType<typeof getDb>
): Promise<readonly ProjectEstimateCostCodeCatalogItem[]> {
  const [sageRows, namedSageRows] = await Promise.all([
    db
      .select()
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(
        asc(sageCostCodes.divisionCode),
        asc(sageCostCodes.displayLabel)
      ),
    db
      .select({
        sourceSystem: projectBudgetLines.sourceSystem,
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        divisionName: projectBudgetLines.csiDivisionName,
      })
      .from(projectBudgetLines)
      .where(
        eq(projectBudgetLines.sourceSystem, "sage_read_snapshot")
      )
      .groupBy(
        projectBudgetLines.sourceSystem,
        projectBudgetLines.costCode,
        projectBudgetLines.description,
        projectBudgetLines.csiDivisionName
      )
      .orderBy(asc(projectBudgetLines.description)),
  ])

  return projectEstimateCostCodeCatalog(sageRows, namedSageRows)
}

export type ProjectBudgetCostCode = {
  readonly costCode: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionName: string
}

/** Match the Budget workspace's latest completed application; never use an import in progress. */
export async function loadProjectBudgetCostCodes(db: ReturnType<typeof getDb>, projectId: string): Promise<readonly ProjectBudgetCostCode[]> {
  const application = await db.select({ id: projectBudgetApplications.id }).from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.projectId, projectId), ne(projectBudgetApplications.status, "building")))
    .orderBy(desc(projectBudgetApplications.periodTo), desc(projectBudgetApplications.createdAt)).get()
  return db.select({ costCode: projectBudgetLines.costCode, description: projectBudgetLines.description, divisionCode: projectBudgetLines.csiDivision, divisionName: projectBudgetLines.csiDivisionName })
    .from(projectBudgetLines).where(and(eq(projectBudgetLines.projectId, projectId), application ? eq(projectBudgetLines.applicationId, application.id) : isNull(projectBudgetLines.applicationId)))
    .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.costCode))
}

export type ProjectCostCodeChoice = ProjectEstimateCostCodeCatalogItem & { readonly onBudget: boolean }

export async function loadProjectCostCodeChoices(db: ReturnType<typeof getDb>, projectId: string): Promise<readonly ProjectCostCodeChoice[]> {
  const [catalog, budget, history] = await Promise.all([
    loadProjectCostCodeCatalog(db),
    loadProjectBudgetCostCodes(db, projectId),
    db.select({ costCode: projectBudgetLines.costCode, description: projectBudgetLines.description, divisionCode: projectBudgetLines.csiDivision, divisionName: projectBudgetLines.csiDivisionName })
      .from(projectBudgetLines).leftJoin(projectBudgetApplications, eq(projectBudgetApplications.id, projectBudgetLines.applicationId))
      .where(and(eq(projectBudgetLines.projectId, projectId), or(isNull(projectBudgetApplications.status), ne(projectBudgetApplications.status, "building")))),
  ])
  const budgetCodes = new Set(budget.map((row) => row.costCode.trim()).filter(Boolean))
  const choices = new Map(catalog.map((row) => [row.code, { ...row, onBudget: budgetCodes.has(row.code) }]))
  // Historical job-only codes stay resolvable when editing an older record.
  for (const row of history) {
    const code = row.costCode.trim()
    if (!code || choices.has(code)) continue
    choices.set(code, { code, sourceCostCode: code, description: row.description, displayLabel: `${code} ${row.description}`, divisionCode: row.divisionCode, divisionDescription: row.divisionName, divisionDisplayLabel: `${row.divisionCode} · ${row.divisionName}`, sageMapped: false, onBudget: budgetCodes.has(code) })
  }
  return [...choices.values()]
}
