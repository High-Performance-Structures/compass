"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { activityEvents, organizationFeatureSettings, projectFieldCostCodes, projects } from "@/db/schema"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { loadProjectCostCodeCatalog, loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { fieldCostCodeIdsSchema, fieldCostCodeListSchema, type FieldCostCode } from "@/lib/field/cost-code-settings"
import { legacyFieldJobCostCodes, loadFieldCostCodeList, loadProjectFieldAdditions } from "@/lib/field/cost-codes-server"
import { requireOrg } from "@/lib/org-scope"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }
type SaveResult = { readonly success: true } | { readonly success: false; readonly error: string }
export type FieldCostCodeEditorView = {
  readonly codes: readonly FieldCostCode[]
  readonly inherited: readonly FieldCostCode[]
  readonly choices: readonly FieldCostCode[]
  readonly canEdit: boolean
  readonly customized: boolean
  readonly combinesDepartmentLists: boolean
}

async function context(projectId?: string) {
  const user = await requireAuth()
  if (!user.isActive || !isInternalStaffRole(user.role)) throw new Error("Field cost-code settings are available to active company staff.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  if (projectId) {
    await requireFeaturePermission(user, "project-hub", "read")
    const access = await getProjectAccessRecord(db, user, projectId)
    if (!access || access.organizationId !== organizationId) throw new Error("Project not found or access denied.")
  }
  const editor = canEditFeatureSettings(user.role, "field-cost-codes") || Boolean(projectId && (user.role === "project_manager" || user.role === "project_administrator"))
  const canEdit = editor && !isDemoUser(user.id) && !isDemoOrg(organizationId)
    && (!projectId || await canFeature(user, "project-hub", "update"))
  return { db, user, organizationId, canEdit }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to update Field Mode cost codes."
}
function invalidate(projectId?: string): void {
  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard/field")
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
  }
}
function uniqueChoices(...lists: readonly (readonly FieldCostCode[])[]): readonly FieldCostCode[] {
  return [...new Map(lists.flat().map((code) => [code.code, code])).values()]
}
function canonicalCodes(raw: unknown, choices: readonly FieldCostCode[]): readonly FieldCostCode[] {
  const parsed = fieldCostCodeIdsSchema.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Choose valid cost codes.")
  const byCode = new Map(choices.map((code) => [code.code, code]))
  const codes = parsed.data.map((id) => {
    const code = byCode.get(id)
    if (!code) throw new Error(`Cost code ${id} is not available. Refresh and choose a company cost code.`)
    return code
  })
  const validated = fieldCostCodeListSchema.safeParse(codes)
  if (!validated.success) throw new Error("A selected cost code has an invalid name or value. Update its company catalog entry and try again.")
  return validated.data
}
async function companyView(ctx: Awaited<ReturnType<typeof context>>): Promise<FieldCostCodeEditorView> {
  const [settings, daily, catalog] = await Promise.all([
    readFeatureSettings(ctx.db, ctx.organizationId, "field-cost-codes"),
    readFeatureSettings(ctx.db, ctx.organizationId, "daily-logs"),
    ctx.canEdit ? loadProjectCostCodeCatalog(ctx.db) : Promise.resolve([]),
  ])
  const legacyLists = daily.laborCodeDepartments.map((department) => legacyFieldJobCostCodes(daily, department))
  const combinesDepartmentLists = settings.defaultCodes === null && new Set(legacyLists.map((list) => JSON.stringify(list.map((code) => code.code).sort()))).size > 1
  const legacy = uniqueChoices(...legacyLists)
  const codes = settings.defaultCodes ?? legacy
  const labor = daily.laborCostCodes.filter((code) => code.active).map(({ code, name }) => ({ code, name }))
  return { codes, inherited: [], choices: ctx.canEdit ? uniqueChoices(catalog.map((code) => ({ code: code.code, name: code.description })), labor, codes) : [], canEdit: ctx.canEdit, customized: settings.defaultCodes !== null, combinesDepartmentLists }
}
export async function getCompanyFieldCostCodes(): Promise<Result<FieldCostCodeEditorView>> {
  try { return { success: true, data: await companyView(await context()) } }
  catch (error) { return { success: false, error: errorMessage(error) } }
}
export async function saveCompanyFieldCostCodes(raw: unknown): Promise<SaveResult> {
  try {
    const ctx = await context()
    if (!ctx.canEdit) return { success: false, error: "Only company admins can change Field Mode defaults." }
    const before = await readFeatureSettings(ctx.db, ctx.organizationId, "field-cost-codes")
    const codes = canonicalCodes(raw, (await companyView(ctx)).choices)
    const now = new Date().toISOString()
    await ctx.db.batch([
      ctx.db.insert(organizationFeatureSettings).values({ organizationId: ctx.organizationId, featureKey: "field-cost-codes", value: JSON.stringify({ defaultCodes: codes }), updatedBy: ctx.user.id, updatedAt: now })
        .onConflictDoUpdate({ target: [organizationFeatureSettings.organizationId, organizationFeatureSettings.featureKey], set: { value: JSON.stringify({ defaultCodes: codes }), updatedBy: ctx.user.id, updatedAt: now } }),
      ctx.db.insert(activityEvents).values({ id: crypto.randomUUID(), organizationId: ctx.organizationId, actorUserId: ctx.user.id, actorName: ctx.user.displayName ?? ctx.user.email, actorRole: ctx.user.role, category: "settings", action: "updated", entityType: "field_cost_code_defaults", summary: "Updated Field Mode default cost codes.", metadata: JSON.stringify({ before, after: { defaultCodes: codes } }), createdAt: now }),
    ])
    invalidate()
    return { success: true }
  } catch (error) { return { success: false, error: errorMessage(error) } }
}
export async function resetCompanyFieldCostCodes(): Promise<SaveResult> {
  try {
    const ctx = await context()
    if (!ctx.canEdit) return { success: false, error: "Only company admins can reset Field Mode defaults." }
    const before = await readFeatureSettings(ctx.db, ctx.organizationId, "field-cost-codes")
    const now = new Date().toISOString()
    await ctx.db.batch([
      ctx.db.delete(organizationFeatureSettings).where(and(eq(organizationFeatureSettings.organizationId, ctx.organizationId), eq(organizationFeatureSettings.featureKey, "field-cost-codes"))),
      ctx.db.insert(activityEvents).values({ id: crypto.randomUUID(), organizationId: ctx.organizationId, actorUserId: ctx.user.id, actorName: ctx.user.displayName ?? ctx.user.email, actorRole: ctx.user.role, category: "settings", action: "reset", entityType: "field_cost_code_defaults", summary: "Reset Field Mode defaults to the configured crew list.", metadata: JSON.stringify({ before, after: { defaultCodes: null } }), createdAt: now }),
    ])
    invalidate()
    return { success: true }
  } catch (error) { return { success: false, error: errorMessage(error) } }
}
export async function getProjectFieldCostCodes(projectId: string): Promise<Result<FieldCostCodeEditorView>> {
  try {
    const ctx = await context(projectId)
    const project = await ctx.db.select({ id: projects.id, department: projects.department, projectNumber: projects.projectNumber, workspaceKind: projects.workspaceKind }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, ctx.organizationId))).get()
    if (!project) return { success: false, error: "Project not found." }
    const [daily, catalog] = await Promise.all([
      readFeatureSettings(ctx.db, ctx.organizationId, "daily-logs"),
      ctx.canEdit ? loadProjectCostCodeChoices(ctx.db, projectId) : Promise.resolve([]),
    ])
    const list = await loadFieldCostCodeList(ctx.db, ctx.organizationId, project, daily)
    return { success: true, data: { codes: list.additions, inherited: list.defaults, choices: ctx.canEdit ? uniqueChoices(catalog.map((code) => ({ code: code.code, name: code.description })), daily.laborCostCodes.filter((code) => code.active).map(({ code, name }) => ({ code, name })), list.defaults, list.additions) : [], canEdit: ctx.canEdit, customized: list.additions.length > 0, combinesDepartmentLists: false } }
  } catch (error) { return { success: false, error: errorMessage(error) } }
}
export async function saveProjectFieldCostCodes(projectId: string, raw: unknown): Promise<SaveResult> {
  try {
    const ctx = await context(projectId)
    if (!ctx.canEdit) return { success: false, error: "Only project managers or company admins can change project Field codes." }
    const view = await getProjectFieldCostCodes(projectId)
    if (!view.success) return view
    const codes = canonicalCodes(raw, view.data.choices)
    const before = await loadProjectFieldAdditions(ctx.db, ctx.organizationId, projectId)
    const now = new Date().toISOString()
    const write = codes.length
      ? ctx.db.insert(projectFieldCostCodes).values({ projectId, organizationId: ctx.organizationId, codesJson: JSON.stringify(codes), updatedAt: now, updatedBy: ctx.user.id })
        .onConflictDoUpdate({ target: projectFieldCostCodes.projectId, set: { codesJson: JSON.stringify(codes), updatedAt: now, updatedBy: ctx.user.id } })
      : ctx.db.delete(projectFieldCostCodes).where(and(eq(projectFieldCostCodes.projectId, projectId), eq(projectFieldCostCodes.organizationId, ctx.organizationId)))
    await ctx.db.batch([write, recordProjectAudit(ctx.db, { organizationId: ctx.organizationId, projectId, actorUserId: ctx.user.id, eventType: codes.length ? "field_cost_codes_updated" : "field_cost_codes_cleared", entityType: "field_cost_codes", entityId: projectId, beforeJson: JSON.stringify(before), afterJson: JSON.stringify(codes), createdAt: now })])
    invalidate(projectId)
    return { success: true }
  } catch (error) { return { success: false, error: errorMessage(error) } }
}
