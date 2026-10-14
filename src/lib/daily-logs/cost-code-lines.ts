import { and, asc, eq, inArray } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectBudgetLines, projects, sageCostCodes } from "@/db/schema"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import {
  DEFAULT_DAILY_LOG_REQUIREMENTS,
  validateDailyLogForm,
  type DailyLogCostCodeOption,
  type DailyLogFormValues,
  type DailyLogRequirements,
  type DailyLogWorkLine,
} from "@/lib/daily-logs/daily-log-form"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { dutiesFor, dutyDisplay } from "@/lib/internal-duties/model"
import { resolvedProjectDepartment } from "@/lib/project-branding"

type Db = ReturnType<typeof getDb>

export type DailyLogWorkLineView = {
  readonly id: string
  readonly costCode: string
  readonly costCodeLabel: string
  readonly hours: number | null
  readonly description: string
}

export const ON_BUDGET_GROUP = "On this job's budget"
export const ALL_CODES_GROUP = "All cost codes"

/**
 * The cost codes a daily log can choose from:
 * - an internal workspace uses its duty list (the 500 codes for the office);
 * - a job in a labor-list department (H and O by default) uses the company's
 *   labor cost codes;
 * - any other job lists the codes on its budget first, then every active
 *   company cost code.
 */
/**
 * Where a project's list comes from. Phones download only the labor codes and
 * the yards' duties (field workspaces in a labor-list department); office
 * duties and the full company list stay in the browser.
 */
export type DailyLogCostCodeSource = "labor" | "yard-duties" | "duties" | "company"

/** Lists Field Mode downloads. */
export const PHONE_COST_CODE_SOURCES: ReadonlySet<DailyLogCostCodeSource> = new Set(["labor", "yard-duties"])

export async function dailyLogCostCodeOptions(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<readonly DailyLogCostCodeOption[]> {
  return (await dailyLogCostCodeList(db, organizationId, projectId)).options
}

export async function dailyLogCostCodeList(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<{ readonly source: DailyLogCostCodeSource; readonly options: readonly DailyLogCostCodeOption[] }> {
  const [project] = await db
    .select({
      workspaceKind: projects.workspaceKind,
      department: projects.department,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const dailyLogSettings = await readFeatureSettings(db, organizationId, "daily-logs")
  const department = resolvedProjectDepartment({ department: project?.department, projectId, projectNumber: project?.projectNumber })
  const inLaborDepartment = department !== null && dailyLogSettings.laborCodeDepartments.includes(department)
  if (project?.workspaceKind) {
    const settings = await readFeatureSettings(db, organizationId, "internal-duties")
    return {
      source: project.workspaceKind === "field" && inLaborDepartment ? "yard-duties" : "duties",
      options: dutiesFor(settings, project.workspaceKind).map((duty) => ({
        code: duty.code,
        name: duty.label,
        label: dutyDisplay(duty.code, duty.label),
        group: "",
      })),
    }
  }

  const laborCodes = dailyLogSettings.laborCostCodes.filter((code) => code.active)
  if (inLaborDepartment && laborCodes.length > 0) {
    return {
      source: "labor",
      options: laborCodes.map((code) => ({ code: code.code, name: code.name, label: `${code.code} ${code.name}`, group: "" })),
    }
  }

  const [companyCodes, budgetRows] = await Promise.all([
    db
      .select({ code: sageCostCodes.code, description: sageCostCodes.description })
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.code)),
    db
      .select({ code: projectBudgetLines.costCode, description: projectBudgetLines.description })
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.projectId, projectId)),
  ])
  const companyLabels = new Map(companyCodes.map((row) => [row.code, row.description]))
  const budget = new Map<string, string>()
  for (const row of budgetRows) {
    const code = row.code.trim()
    if (code && !budget.has(code)) budget.set(code, companyLabels.get(code) ?? row.description)
  }
  return {
    source: "company",
    options: [
    ...[...budget.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, description]) => ({ code, name: description, label: `${code} ${description}`.trim(), group: ON_BUDGET_GROUP })),
    ...companyCodes
      .filter((row) => !budget.has(row.code))
      .map((row) => ({ code: row.code, name: row.description, label: `${row.code} ${row.description}`.trim(), group: ALL_CODES_GROUP })),
    ],
  }
}

export async function dailyLogRequirements(db: Db, organizationId: string): Promise<DailyLogRequirements> {
  const settings = await readFeatureSettings(db, organizationId, "daily-logs")
  return { requireCostCodeTime: settings.requireCostCodeTime, requiredFields: settings.requiredFields }
}

/** What a daily log form needs: the project's cost codes and the company's required fields. */
export type DailyLogFormSetup = {
  readonly source: DailyLogCostCodeSource
  readonly costCodes: readonly DailyLogCostCodeOption[]
  readonly requirements: DailyLogRequirements
}

export const EMPTY_DAILY_LOG_FORM_SETUP: DailyLogFormSetup = {
  source: "company",
  costCodes: [],
  requirements: DEFAULT_DAILY_LOG_REQUIREMENTS,
}

/**
 * What Field Mode downloads for a project. Projects on a browser-only list
 * (N and D jobs, office workspaces) get no codes on the phone, and their
 * phone logs don't require one; the office adds codes in the browser.
 */
export function phoneDailyLogForm(setup: DailyLogFormSetup): {
  readonly costCodes: DailyLogCostCodeOption[]
  readonly requirements: { readonly requireCostCodeTime: boolean; readonly requiredFields: DailyLogRequirements["requiredFields"][number][] }
} {
  const onPhone = PHONE_COST_CODE_SOURCES.has(setup.source)
  return {
    costCodes: onPhone ? [...setup.costCodes] : [],
    requirements: {
      requireCostCodeTime: onPhone && setup.requirements.requireCostCodeTime,
      requiredFields: [...setup.requirements.requiredFields],
    },
  }
}

export async function dailyLogFormSetup(db: Db, organizationId: string, projectId: string): Promise<DailyLogFormSetup> {
  const [list, requirements] = await Promise.all([
    dailyLogCostCodeList(db, organizationId, projectId),
    dailyLogRequirements(db, organizationId),
  ])
  return { source: list.source, costCodes: list.options, requirements }
}

/** Each log's cost code lines, in the order they were entered. */
export async function loadDailyLogWorkLines(
  db: Db,
  dailyLogIds: readonly string[],
): Promise<ReadonlyMap<string, readonly DailyLogWorkLineView[]>> {
  const lines = new Map<string, DailyLogWorkLineView[]>()
  if (dailyLogIds.length === 0) return lines
  // D1 caps bound parameters per query, so read in chunks.
  for (let start = 0; start < dailyLogIds.length; start += 90) {
    const rows = await db
      .select({
        id: internalDutyEntries.id,
        dailyLogId: internalDutyEntries.dailyLogId,
        costCode: internalDutyEntries.dutyCode,
        costCodeLabel: internalDutyEntries.dutyLabel,
        hours: internalDutyEntries.hours,
        description: internalDutyEntries.notes,
        sortOrder: internalDutyEntries.sortOrder,
        createdAt: internalDutyEntries.createdAt,
      })
      .from(internalDutyEntries)
      .where(inArray(internalDutyEntries.dailyLogId, dailyLogIds.slice(start, start + 90)))
    for (const row of rows.toSorted((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))) {
      if (!row.dailyLogId) continue
      const list = lines.get(row.dailyLogId) ?? []
      list.push({
        id: row.id,
        costCode: row.costCode,
        costCodeLabel: row.costCodeLabel,
        hours: row.hours,
        description: row.description ?? "",
      })
      lines.set(row.dailyLogId, list)
    }
  }
  return lines
}

/**
 * Replaces a daily log's cost code lines. Codes are labeled from the options;
 * a code no longer on the list keeps the label it was saved with.
 */
export async function replaceDailyLogWorkLines(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly dailyLogId: string
    readonly logDate: string
    readonly userId: string | null
    readonly createdBy: string
    readonly lines: readonly DailyLogWorkLine[]
    readonly options: readonly DailyLogCostCodeOption[]
  },
): Promise<void> {
  const existing = await db
    .select({ code: internalDutyEntries.dutyCode, label: internalDutyEntries.dutyLabel })
    .from(internalDutyEntries)
    .where(eq(internalDutyEntries.dailyLogId, input.dailyLogId))
  const labels = new Map(existing.map((row) => [row.code, row.label]))
  for (const option of input.options) labels.set(option.code, option.name)

  await db
    .delete(internalDutyEntries)
    .where(and(eq(internalDutyEntries.dailyLogId, input.dailyLogId), eq(internalDutyEntries.projectId, input.projectId)))
  if (input.lines.length === 0) return
  const now = new Date().toISOString()
  // One insert per line keeps each statement under D1's bound-parameter cap.
  for (const [index, line] of input.lines.entries()) {
    await db.insert(internalDutyEntries).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      entryDate: input.logDate,
      userId: input.userId,
      dutyCode: line.costCode,
      dutyLabel: labels.get(line.costCode) ?? line.costCode,
      hours: line.hours,
      notes: line.description || null,
      relatedProjectId: null,
      dailyLogId: input.dailyLogId,
      sortOrder: index,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export type CheckedDailyLogForm =
  | {
      readonly ok: true
      readonly lines: readonly DailyLogWorkLine[]
      readonly options: readonly DailyLogCostCodeOption[]
    }
  | { readonly ok: false; readonly error: string }

/**
 * Applies the company's daily log rules on the server: required fields and
 * cost code lines against the project's list. A cost code already on this
 * log stays valid even if it has since left the list, as does any code on a
 * log queued on a phone (`allowUnlistedCodes`).
 */
export async function checkDailyLogForm(
  db: Db,
  organizationId: string,
  projectId: string,
  values: DailyLogFormValues,
  existingDailyLogId: string | null,
  allowUnlistedCodes: boolean,
): Promise<CheckedDailyLogForm> {
  const [list, companyRequirements, existing] = await Promise.all([
    dailyLogCostCodeList(db, organizationId, projectId),
    dailyLogRequirements(db, organizationId),
    existingDailyLogId
      ? db
          .select({ code: internalDutyEntries.dutyCode })
          .from(internalDutyEntries)
          .where(eq(internalDutyEntries.dailyLogId, existingDailyLogId))
      : Promise.resolve([]),
  ])
  const options = list.options
  // Phones don't get browser-only lists, so their logs for those projects
  // can't be held to the cost code rule.
  const requirements =
    allowUnlistedCodes && !PHONE_COST_CODE_SOURCES.has(list.source)
      ? { ...companyRequirements, requireCostCodeTime: false }
      : companyRequirements
  const allowed = allowUnlistedCodes
    ? [...options, ...values.workLines.map((line) => ({ code: line.costCode.trim() }))]
    : [...options, ...existing.map((row) => ({ code: row.code }))]
  const { errors, workLines } = validateDailyLogForm(values, requirements, allowed)
  if (errors.length > 0) {
    return { ok: false, error: errors.map((error) => error.message).join(" ") }
  }
  return { ok: true, lines: workLines, options }
}
