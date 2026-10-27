import { and, eq, inArray } from "drizzle-orm"
import type { getDb } from "@/db"
import { projects } from "@/db/schema"
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
import { loadProjectCostCodeCatalog, loadProjectCostCodeChoices, loadProjectBudgetCostCodes } from "@/lib/cost-codes/catalog-server"
import { dutiesFor, dutyDisplay, dutyOnPhones } from "@/lib/internal-duties/model"
import { resolvedProjectDepartment } from "@/lib/project-branding"

type Db = ReturnType<typeof getDb>

export type DailyLogWorkLineView = {
  readonly id: string
  readonly costCode: string
  readonly costCodeLabel: string
  readonly hours: number | null
  readonly description: string
  /** The to-do these hours went to, if any. */
  readonly todoId: string | null
}

export const ON_BUDGET_GROUP = "On this job's budget"
export const ALL_CODES_GROUP = "All cost codes"
export const INTERNAL_CODES_GROUP = "Customized duty codes"

/** All job logs use the company catalog; internal workspaces use duties. */
export type DailyLogCostCodeSource = "labor" | "duties" | "company"

/**
 * A project's cost codes, and the part of them Field Mode downloads. Phones
 * in enabled departments get the same full job catalog as the browser. Internal
 * workspaces still download only duties marked "On phones".
 */
export type DailyLogCostCodeList = {
  readonly source: DailyLogCostCodeSource
  readonly options: readonly DailyLogCostCodeOption[]
  readonly phoneOptions: readonly DailyLogCostCodeOption[]
}

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
): Promise<DailyLogCostCodeList> {
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
    const duties = dutiesFor(settings, project.workspaceKind).map((duty) => ({
      code: duty.code,
      name: duty.label,
      label: dutyDisplay(duty.code, duty.label),
      group: INTERNAL_CODES_GROUP,
    }))
    const phoneCodes = new Set(settings.duties.filter(dutyOnPhones).map((duty) => duty.code))
    const company = await loadProjectCostCodeCatalog(db)
    const dutyCodes = new Set(duties.map((option) => option.code))
    const companyOptions = company.filter((row) => !dutyCodes.has(row.code)).map((row) => ({ code: row.code, name: row.description, label: row.displayLabel, group: ALL_CODES_GROUP }))
    return {
      source: "duties",
      options: [...duties, ...companyOptions],
      phoneOptions: inLaborDepartment ? [...duties.filter((option) => phoneCodes.has(option.code)), ...companyOptions] : [],
    }
  }

  const laborCodes = inLaborDepartment ? dailyLogSettings.laborCostCodes.filter((code) => code.active) : []
  const [companyCodes, budgetRows] = await Promise.all([
    loadProjectCostCodeChoices(db, projectId),
    loadProjectBudgetCostCodes(db, projectId),
  ])
  const companyLabels = new Map(companyCodes.map((row) => [row.code, row.description]))
  // Keep company-added labor choices available without restricting the catalog.
  for (const row of laborCodes) {
    if (!companyLabels.has(row.code)) companyLabels.set(row.code, row.name)
  }
  const budget = new Map<string, string>()
  for (const row of budgetRows) {
    const code = row.costCode.trim()
    if (code && !budget.has(code)) budget.set(code, companyLabels.get(code) ?? row.description)
  }
  const options = [
    ...[...budget.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, description]) => ({ code, name: description, label: `${code} ${description}`.trim(), group: ON_BUDGET_GROUP })),
    ...[...companyLabels.entries()]
      .filter(([code]) => !budget.has(code))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, description]) => ({ code, name: description, label: `${code} ${description}`.trim(), group: ALL_CODES_GROUP })),
  ]
  return { source: "company", options, phoneOptions: inLaborDepartment ? options : [] }
}

export async function dailyLogRequirements(db: Db, organizationId: string): Promise<DailyLogRequirements> {
  const settings = await readFeatureSettings(db, organizationId, "daily-logs")
  return { requireCostCodeTime: settings.requireCostCodeTime, requiredFields: settings.requiredFields }
}

/** What a daily log form needs: the project's cost codes and the company's required fields. */
export type DailyLogFormSetup = {
  readonly source: DailyLogCostCodeSource
  readonly costCodes: readonly DailyLogCostCodeOption[]
  /** The codes Field Mode downloads for this project (may be none). */
  readonly phoneCostCodes: readonly DailyLogCostCodeOption[]
  readonly requirements: DailyLogRequirements
}

export const EMPTY_DAILY_LOG_FORM_SETUP: DailyLogFormSetup = {
  source: "company",
  costCodes: [],
  phoneCostCodes: [],
  requirements: DEFAULT_DAILY_LOG_REQUIREMENTS,
}

/**
 * What Field Mode downloads for a project. A project with no phone codes (N
 * and D jobs, most office duties) doesn't require one on the phone; the
 * office adds codes in the browser.
 */
export function phoneDailyLogForm(setup: DailyLogFormSetup): {
  readonly costCodes: DailyLogCostCodeOption[]
  readonly requirements: { readonly requireCostCodeTime: boolean; readonly requiredFields: DailyLogRequirements["requiredFields"][number][] }
} {
  return {
    costCodes: [...setup.phoneCostCodes],
    requirements: {
      requireCostCodeTime: setup.phoneCostCodes.length > 0 && setup.requirements.requireCostCodeTime,
      requiredFields: [...setup.requirements.requiredFields],
    },
  }
}

export async function dailyLogFormSetup(db: Db, organizationId: string, projectId: string): Promise<DailyLogFormSetup> {
  const [list, requirements] = await Promise.all([
    dailyLogCostCodeList(db, organizationId, projectId),
    dailyLogRequirements(db, organizationId),
  ])
  return { source: list.source, costCodes: list.options, phoneCostCodes: list.phoneOptions, requirements }
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
        todoId: internalDutyEntries.todoId,
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
        todoId: row.todoId,
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
      todoId: line.todoId,
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
  // A phone with no codes for this project can't meet the cost code rule.
  const requirements =
    allowUnlistedCodes && list.phoneOptions.length === 0
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
