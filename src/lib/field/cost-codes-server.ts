import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectFieldCostCodes } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { DailyLogSettings, InternalDutySettings } from "@/lib/feature-settings/registry"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
import { dutiesFor, dutyOnPhones, isWorkspaceKind } from "@/lib/internal-duties/model"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import { mergeFieldCostCodes, parseProjectFieldCostCodes, type FieldCostCode } from "./cost-code-settings"

type Db = ReturnType<typeof getDb>
export type FieldCostCodeProject = {
  readonly id: string
  readonly department: string | null
  readonly projectNumber: string | null
  readonly workspaceKind: string | null
}

/** Preserve the crew choices that existed before explicit Field defaults were introduced. */
export function legacyFieldJobCostCodes(settings: DailyLogSettings, department: string | null): readonly FieldCostCode[] {
  const enabled = settings.laborCodeDepartments.some((value) => value === department)
  const codes = new Map(enabled ? settings.laborCostCodes.filter((code) => code.active).map((code) => [code.code, { code: code.code, name: code.name }]) : [])
  if (codes.size && (department === "D" || department === "H" || department === "O")) {
    for (const row of projectEstimateCostCodeCatalog([], [])) {
      if ((row.divisionCode === "00" || row.divisionCode === "01") && !codes.has(row.code)) {
        codes.set(row.code, { code: row.code, name: row.description })
      }
    }
  }
  return [...codes.values()]
}

export async function loadProjectFieldAdditions(db: Db, organizationId: string, projectId: string): Promise<readonly FieldCostCode[]> {
  const row = await db.select({ codesJson: projectFieldCostCodes.codesJson }).from(projectFieldCostCodes)
    .where(and(eq(projectFieldCostCodes.projectId, projectId), eq(projectFieldCostCodes.organizationId, organizationId))).get()
  return parseProjectFieldCostCodes(row?.codesJson)
}

/** No catalog or budget fallback: only configured Field defaults/duties and deliberate additions. */
export async function loadFieldCostCodeList(db: Db, organizationId: string, project: FieldCostCodeProject, dailySettings: DailyLogSettings, internalSettings?: InternalDutySettings): Promise<{
  readonly defaults: readonly FieldCostCode[]
  readonly additions: readonly FieldCostCode[]
  readonly effective: readonly FieldCostCode[]
}> {
  const [settings, additions] = await Promise.all([
    readFeatureSettings(db, organizationId, "field-cost-codes"),
    loadProjectFieldAdditions(db, organizationId, project.id),
  ])
  const department = resolvedProjectDepartment({ department: project.department, projectId: project.id, projectNumber: project.projectNumber })
  const enabled = dailySettings.laborCodeDepartments.some((value) => value === department)
  let defaults: readonly FieldCostCode[] = []
  if (project.workspaceKind !== null && isWorkspaceKind(project.workspaceKind)) {
    const duties = internalSettings ?? await readFeatureSettings(db, organizationId, "internal-duties")
    const phoneCodes = new Set(duties.duties.filter(dutyOnPhones).map((duty) => duty.code))
    defaults = enabled ? dutiesFor(duties, project.workspaceKind).filter((duty) => phoneCodes.has(duty.code)).map((duty) => ({ code: duty.code, name: duty.label })) : []
  } else if (!project.workspaceKind && enabled) {
    defaults = settings.defaultCodes ?? legacyFieldJobCostCodes(dailySettings, department)
  }
  return { defaults, additions, effective: mergeFieldCostCodes(defaults, additions) }
}
