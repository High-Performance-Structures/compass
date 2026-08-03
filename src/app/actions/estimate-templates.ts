"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects, sageCostCodes } from "@/db/schema"
import {
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import {
  estimateTemplateDefaults,
  estimateTemplateLines,
  projectTemplateModules,
  projectTemplates,
  projectTemplateVersions,
} from "@/db/schema-templates"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import { requireOrg } from "@/lib/org-scope"
import { can, requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  buildEstimateTemplateApplication,
  type EstimateTemplateSourceLine,
} from "@/lib/templates/estimate-template-application"
import { isInternalStaffRole } from "@/lib/user-roles"

type CompassDb = ReturnType<typeof getDb>

export type EstimateTemplateOption = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly departmentCode: string | null
  readonly versionNumber: number
  readonly lineCount: number
  readonly requiresProjectTaxEntity: boolean
}

export type EstimateTemplateEditorLine = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly specifications: string | null
  readonly quantity: number
  readonly unit: string
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxCode: string | null
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type EstimateTemplateEditor = {
  readonly canEdit: boolean
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly departmentCode: string | null
  readonly lifecycleStatus: string
  readonly reviewStatus: string
  readonly versionId: string
  readonly versionNumber: number
  readonly versionStatus: string
  readonly documentTitle: string
  readonly contractTerms: string | null
  readonly defaultMarkupRateBasisPoints: number
  readonly lines: readonly EstimateTemplateEditorLine[]
  readonly costCodes: readonly {
    readonly value: string
    readonly label: string
    readonly divisionCode: string
    readonly divisionName: string
  }[]
  readonly taxCodes: readonly {
    readonly value: string
    readonly label: string
    readonly rateBasisPoints: number
  }[]
}

export type EstimateTemplateLineInput = {
  readonly costCode: string | null
  readonly description: string | null
  readonly specifications: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly unitCost: number | null
  readonly markupPercent: number | null
  readonly taxable: boolean
  readonly taxCode: string | null
  readonly ownerVisible: boolean
}

type ActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type TemplateAccess = {
  readonly db: CompassDb
  readonly env: CloudflareEnv
  readonly organizationId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
}

function ensureInternal(role: string): void {
  if (!isInternalStaffRole(role)) {
    throw new Error("Template management is limited to internal staff.")
  }
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function nonNegative(value: number | null, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error("Quantity, cost, and markup cannot be negative.")
  }
  return resolved
}

async function templateAccess(
  action: "read" | "update"
): Promise<TemplateAccess> {
  const user = await requireAuth()
  requirePermission(user, "budget", action)
  ensureInternal(user.role)
  if (action === "update" && isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), env, organizationId, user }
}

async function editableTemplateVersion(
  access: TemplateAccess,
  templateId: string
): Promise<{
  readonly template: typeof projectTemplates.$inferSelect
  readonly version: typeof projectTemplateVersions.$inferSelect
}> {
  const template = await access.db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, access.organizationId),
        eq(projectTemplates.templateKind, "estimate")
      )
    )
    .get()
  if (!template) throw new Error("Estimate template not found.")
  const version = await access.db
    .select()
    .from(projectTemplateVersions)
    .where(eq(projectTemplateVersions.templateId, template.id))
    .orderBy(desc(projectTemplateVersions.versionNumber))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!version) throw new Error("Estimate template version not found.")
  if (version.status !== "draft") {
    throw new Error("Create a new revision before editing this published template.")
  }
  return { template, version }
}

function revalidateTemplates(templateId?: string): void {
  revalidatePath("/dashboard/templates")
  if (templateId) revalidatePath(`/dashboard/templates/${templateId}`)
}

export async function getPublishedEstimateTemplateOptions(): Promise<
  readonly EstimateTemplateOption[]
> {
  const access = await templateAccess("read")
  const templates = await access.db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.organizationId, access.organizationId),
        eq(projectTemplates.templateKind, "estimate"),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified")
      )
    )
    .orderBy(asc(projectTemplates.name))
  const versionNumbers = templates.flatMap((template) =>
    template.currentVersionNumber === null
      ? []
      : [{ templateId: template.id, versionNumber: template.currentVersionNumber }]
  )
  if (versionNumbers.length === 0) return []
  const versions = await access.db
    .select()
    .from(projectTemplateVersions)
    .where(
      inArray(
        projectTemplateVersions.templateId,
        versionNumbers.map((item) => item.templateId)
      )
    )
  const published = versions.filter((version) =>
    versionNumbers.some(
      (item) =>
        item.templateId === version.templateId &&
        item.versionNumber === version.versionNumber &&
        version.status === "published"
    )
  )
  const lines = published.length
    ? await access.db
        .select({
          versionId: estimateTemplateLines.versionId,
          taxable: estimateTemplateLines.taxable,
          taxCode: estimateTemplateLines.taxCode,
        })
        .from(estimateTemplateLines)
        .where(
          inArray(
            estimateTemplateLines.versionId,
            published.map((version) => version.id)
          )
        )
    : []

  return templates.flatMap((template) => {
    const version = published.find(
      (candidate) => candidate.templateId === template.id
    )
    if (!version) return []
    return [
      {
        id: template.id,
        name: template.name,
        description: template.description,
        departmentCode: template.departmentCode,
        versionNumber: version.versionNumber,
        lineCount: lines.filter((line) => line.versionId === version.id).length,
        requiresProjectTaxEntity: lines.some(
          (line) =>
            line.versionId === version.id && line.taxable && !line.taxCode
        ),
      },
    ]
  })
}

export async function getEstimateTemplateEditor(
  templateId: string
): Promise<EstimateTemplateEditor | null> {
  const access = await templateAccess("read")
  const template = await access.db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, access.organizationId),
        eq(projectTemplates.templateKind, "estimate")
      )
    )
    .get()
  if (!template) return null
  const version = await access.db
    .select()
    .from(projectTemplateVersions)
    .where(eq(projectTemplateVersions.templateId, template.id))
    .orderBy(desc(projectTemplateVersions.versionNumber))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!version) return null

  const [defaults, lines, costCodes, taxCodes] = await Promise.all([
    access.db
      .select()
      .from(estimateTemplateDefaults)
      .where(eq(estimateTemplateDefaults.versionId, version.id))
      .get(),
    access.db
      .select()
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
      .orderBy(
        asc(estimateTemplateLines.divisionCode),
        asc(estimateTemplateLines.sortOrder)
      ),
    access.db
      .select()
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel)),
    access.db
      .select()
      .from(sageTaxEntities)
      .where(eq(sageTaxEntities.active, true))
      .orderBy(asc(sageTaxEntities.name)),
  ])
  if (!defaults) return null

  return {
    canEdit: can(access.user, "budget", "update"),
    id: template.id,
    name: template.name,
    description: template.description,
    departmentCode: template.departmentCode,
    lifecycleStatus: template.lifecycleStatus,
    reviewStatus: template.reviewStatus,
    versionId: version.id,
    versionNumber: version.versionNumber,
    versionStatus: version.status,
    documentTitle: defaults.documentTitle,
    contractTerms: defaults.contractTerms,
    defaultMarkupRateBasisPoints: defaults.defaultMarkupRateBasisPoints,
    lines: lines.map((line) => ({
      id: line.id,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: line.specifications,
      quantity: line.quantity,
      unit: line.unit,
      unitCostCents: line.unitCostCents,
      markupRateBasisPoints: line.markupRateBasisPoints,
      taxable: line.taxable,
      taxCode: line.taxCode,
      ownerVisible: line.ownerVisible,
      sortOrder: line.sortOrder,
    })),
    costCodes: [
      ...costCodes.map((costCode) => ({
        value: costCode.code,
        label: costCode.displayLabel,
        divisionCode: costCode.divisionCode,
        divisionName: costCode.divisionDescription,
      })),
      ...CONTRACT_ADJUSTMENT_COST_CODES.map((costCode) => ({
        value: costCode.value,
        label: `${costCode.value} · ${costCode.description}`,
        divisionCode: "99",
        divisionName: "Contract Adjustments",
      })),
    ],
    taxCodes: taxCodes.map((taxCode) => ({
      value: taxCode.code,
      label: `${taxCode.code} · ${taxCode.name}`,
      rateBasisPoints: taxCode.rateBasisPoints,
    })),
  }
}

export async function createEstimateTemplateDraft(input: {
  readonly name: string | null
  readonly description: string | null
  readonly departmentCode: string | null
}): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const id = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const results = await access.env.DB.batch([
      access.env.DB.prepare(
        `INSERT INTO project_templates (
          id, organization_id, source_system, source_key, name, description,
          template_kind, department_code, trade_category, lifecycle_status,
          review_status, current_version_number, created_by, created_at, updated_at
        ) VALUES (?, ?, 'compass', ?, ?, ?, 'estimate', ?, 'Estimating',
          'draft', 'content_captured', 1, ?, ?, ?)`
      ).bind(
        id,
        access.organizationId,
        `compass:${id}`,
        requiredText(input.name, "Template name"),
        cleanText(input.description),
        cleanText(input.departmentCode),
        access.user.id,
        now,
        now
      ),
      access.env.DB.prepare(
        `INSERT INTO project_template_versions (
          id, template_id, version_number, status, notes, created_by, created_at
        ) VALUES (?, ?, 1, 'draft', 'Created in Compass', ?, ?)`
      ).bind(versionId, id, access.user.id, now),
      access.env.DB.prepare(
        `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count, normalization_status
        ) VALUES (?, ?, 'estimate', 0, 'draft')`
      ).bind(crypto.randomUUID(), versionId),
      access.env.DB.prepare(
        `INSERT INTO estimate_template_defaults (
          version_id, document_title, default_markup_rate_basis_points
        ) VALUES (?, 'CA22 Construction Estimate', 0)`
      ).bind(versionId),
    ])
    if (results.some((result) => !result.success)) {
      throw new Error("Estimate template creation failed.")
    }
    revalidateTemplates(id)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create the estimate template.",
    }
  }
}

export async function updateEstimateTemplateDraft(input: {
  readonly templateId: string
  readonly name: string | null
  readonly description: string | null
  readonly departmentCode: string | null
  readonly documentTitle: string | null
  readonly contractTerms: string | null
  readonly defaultMarkupPercent: number | null
}): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const { version } = await editableTemplateVersion(access, input.templateId)
    const markupPercent = nonNegative(input.defaultMarkupPercent, 0)
    const now = new Date().toISOString()
    await access.db.batch([
      access.db
        .update(projectTemplates)
        .set({
          name: requiredText(input.name, "Template name"),
          description: cleanText(input.description),
          departmentCode: cleanText(input.departmentCode),
          updatedAt: now,
        })
        .where(eq(projectTemplates.id, input.templateId)),
      access.db
        .update(estimateTemplateDefaults)
        .set({
          documentTitle: requiredText(input.documentTitle, "Document title"),
          contractTerms: cleanText(input.contractTerms),
          defaultMarkupRateBasisPoints: Math.round(markupPercent * 100),
        })
        .where(eq(estimateTemplateDefaults.versionId, version.id)),
    ])
    revalidateTemplates(input.templateId)
    return { success: true, id: input.templateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the estimate template.",
    }
  }
}

export async function saveEstimateTemplateLine(
  templateId: string,
  lineId: string | null,
  input: EstimateTemplateLineInput
): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const { version } = await editableTemplateVersion(access, templateId)
    const costCode = requiredText(input.costCode, "Cost code")
    const adjustment = CONTRACT_ADJUSTMENT_COST_CODES.find(
      (candidate) => candidate.value === costCode
    )
    const sageCostCode = adjustment
      ? null
      : await access.db
          .select()
          .from(sageCostCodes)
          .where(
            and(
              eq(sageCostCodes.code, costCode),
              eq(sageCostCodes.active, true)
            )
          )
          .get()
    if (!adjustment && !sageCostCode) {
      throw new Error("Choose an active Sage cost code.")
    }
    const taxCode = cleanText(input.taxCode)
    if (input.taxable && taxCode) {
      const tax = await access.db
        .select({ code: sageTaxEntities.code })
        .from(sageTaxEntities)
        .where(
          and(
            eq(sageTaxEntities.code, taxCode),
            eq(sageTaxEntities.active, true)
          )
        )
        .get()
      if (!tax) throw new Error("Choose an active Sage tax code.")
    }
    const quantity = nonNegative(input.quantity, 1)
    const unitCostCents = Math.round(nonNegative(input.unitCost, 0) * 100)
    const markupRateBasisPoints = Math.round(
      nonNegative(input.markupPercent, 0) * 100
    )
    const now = new Date().toISOString()
    const existing = lineId
      ? await access.db
          .select()
          .from(estimateTemplateLines)
          .where(
            and(
              eq(estimateTemplateLines.id, lineId),
              eq(estimateTemplateLines.versionId, version.id)
            )
          )
          .get()
      : null
    if (lineId && !existing) throw new Error("Template line not found.")
    const last = await access.db
      .select({ sortOrder: estimateTemplateLines.sortOrder })
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
      .orderBy(desc(estimateTemplateLines.sortOrder))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const id = lineId ?? crypto.randomUUID()
    const values = {
      versionId: version.id,
      itemKey: existing?.itemKey ?? id,
      divisionCode: sageCostCode?.divisionCode ?? "99",
      divisionName: sageCostCode?.divisionDescription ?? "Contract Adjustments",
      costCode: sageCostCode?.code ?? adjustment?.value ?? costCode,
      costCodeName:
        sageCostCode?.description ?? adjustment?.description ?? costCode,
      description: requiredText(input.description, "Description"),
      specifications: cleanText(input.specifications),
      quantity,
      unit: cleanText(input.unit) ?? "LS",
      unitCostCents,
      markupRateBasisPoints,
      taxable: input.taxable,
      taxCode: input.taxable ? taxCode : null,
      ownerVisible: input.ownerVisible,
      sortOrder: existing?.sortOrder ?? (last?.sortOrder ?? -1) + 1,
    }
    if (existing) {
      await access.db
        .update(estimateTemplateLines)
        .set(values)
        .where(eq(estimateTemplateLines.id, existing.id))
    } else {
      await access.db.insert(estimateTemplateLines).values({ id, ...values })
    }
    const count = await access.db
      .select({ id: estimateTemplateLines.id })
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
    await access.db
      .update(projectTemplateModules)
      .set({ sourceItemCount: count.length, normalizationStatus: "draft" })
      .where(
        and(
          eq(projectTemplateModules.versionId, version.id),
          eq(projectTemplateModules.moduleType, "estimate")
        )
      )
    await access.db
      .update(projectTemplates)
      .set({ updatedAt: now })
      .where(eq(projectTemplates.id, templateId))
    revalidateTemplates(templateId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the estimate template line.",
    }
  }
}

export async function deleteEstimateTemplateLine(
  templateId: string,
  lineId: string
): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const { version } = await editableTemplateVersion(access, templateId)
    await access.db
      .delete(estimateTemplateLines)
      .where(
        and(
          eq(estimateTemplateLines.id, lineId),
          eq(estimateTemplateLines.versionId, version.id)
        )
      )
    const count = await access.db
      .select({ id: estimateTemplateLines.id })
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
    await access.db
      .update(projectTemplateModules)
      .set({ sourceItemCount: count.length })
      .where(
        and(
          eq(projectTemplateModules.versionId, version.id),
          eq(projectTemplateModules.moduleType, "estimate")
        )
      )
    revalidateTemplates(templateId)
    return { success: true, id: lineId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to remove the estimate template line.",
    }
  }
}

export async function publishEstimateTemplate(
  templateId: string
): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const { version } = await editableTemplateVersion(access, templateId)
    const lines = await access.db
      .select()
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
    if (lines.length === 0) {
      throw new Error("Add at least one estimate line before publishing.")
    }
    const adjustmentCodes = new Set<string>(
      CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.value)
    )
    const sageCodes = [
      ...new Set(
        lines
          .map((line) => line.costCode)
          .filter((code) => !adjustmentCodes.has(code))
      ),
    ]
    const activeCostCodes = sageCodes.length
      ? await access.db
          .select({ code: sageCostCodes.code })
          .from(sageCostCodes)
          .where(
            and(
              inArray(sageCostCodes.code, sageCodes),
              eq(sageCostCodes.active, true)
            )
          )
      : []
    const activeCostCodeSet = new Set(activeCostCodes.map((row) => row.code))
    const missingCostCode = sageCodes.find(
      (code) => !activeCostCodeSet.has(code)
    )
    if (missingCostCode) {
      throw new Error(
        `Cost code ${missingCostCode} is no longer active in Sage. Update the template before publishing.`
      )
    }
    const fixedTaxCodes = [
      ...new Set(lines.flatMap((line) => (line.taxCode ? [line.taxCode] : []))),
    ]
    const activeTaxCodes = fixedTaxCodes.length
      ? await access.db
          .select({ code: sageTaxEntities.code })
          .from(sageTaxEntities)
          .where(
            and(
              inArray(sageTaxEntities.code, fixedTaxCodes),
              eq(sageTaxEntities.active, true)
            )
          )
      : []
    const activeTaxCodeSet = new Set(activeTaxCodes.map((row) => row.code))
    const missingTaxCode = fixedTaxCodes.find(
      (code) => !activeTaxCodeSet.has(code)
    )
    if (missingTaxCode) {
      throw new Error(
        `Tax code ${missingTaxCode} is no longer active in Sage. Update the template before publishing.`
      )
    }
    const now = new Date().toISOString()
    await access.db.batch([
      access.db
        .update(projectTemplateVersions)
        .set({ status: "published" })
        .where(eq(projectTemplateVersions.id, version.id)),
      access.db
        .update(projectTemplateModules)
        .set({
          sourceItemCount: lines.length,
          normalizationStatus: "published",
        })
        .where(
          and(
            eq(projectTemplateModules.versionId, version.id),
            eq(projectTemplateModules.moduleType, "estimate")
          )
        ),
      access.db
        .update(projectTemplates)
        .set({
          lifecycleStatus: "active",
          reviewStatus: "verified",
          currentVersionNumber: version.versionNumber,
          updatedAt: now,
        })
        .where(eq(projectTemplates.id, templateId)),
    ])
    revalidateTemplates(templateId)
    return { success: true, id: templateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to publish the estimate template.",
    }
  }
}

export async function createEstimateTemplateRevision(
  templateId: string
): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const template = await access.db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, templateId),
          eq(projectTemplates.organizationId, access.organizationId),
          eq(projectTemplates.templateKind, "estimate")
        )
      )
      .get()
    if (!template) throw new Error("Estimate template not found.")
    const latest = await access.db
      .select()
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.templateId, templateId))
      .orderBy(desc(projectTemplateVersions.versionNumber))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!latest) throw new Error("Estimate template version not found.")
    if (latest.status === "draft") {
      throw new Error("This template already has an editable draft revision.")
    }
    const [defaults, lines] = await Promise.all([
      access.db
        .select()
        .from(estimateTemplateDefaults)
        .where(eq(estimateTemplateDefaults.versionId, latest.id))
        .get(),
      access.db
        .select()
        .from(estimateTemplateLines)
        .where(eq(estimateTemplateLines.versionId, latest.id)),
    ])
    if (!defaults) throw new Error("Estimate template defaults are missing.")
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const statements: D1PreparedStatement[] = [
      access.env.DB.prepare(
        `INSERT INTO project_template_versions (
          id, template_id, version_number, status, notes, created_by, created_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`
      ).bind(
        versionId,
        templateId,
        latest.versionNumber + 1,
        `Revision of version ${latest.versionNumber}`,
        access.user.id,
        now
      ),
      access.env.DB.prepare(
        `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count, normalization_status
        ) VALUES (?, ?, 'estimate', ?, 'draft')`
      ).bind(crypto.randomUUID(), versionId, lines.length),
      access.env.DB.prepare(
        `INSERT INTO estimate_template_defaults (
          version_id, document_title, contract_terms,
          default_markup_rate_basis_points
        ) VALUES (?, ?, ?, ?)`
      ).bind(
        versionId,
        defaults.documentTitle,
        defaults.contractTerms,
        defaults.defaultMarkupRateBasisPoints
      ),
    ]
    for (const line of lines) {
      statements.push(
        access.env.DB.prepare(
          `INSERT INTO estimate_template_lines (
            id, version_id, item_key, division_code, division_name, cost_code,
            cost_code_name, description, specifications, quantity, unit,
            unit_cost_cents, markup_rate_basis_points, taxable, tax_code,
            owner_visible, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          versionId,
          line.itemKey,
          line.divisionCode,
          line.divisionName,
          line.costCode,
          line.costCodeName,
          line.description,
          line.specifications,
          line.quantity,
          line.unit,
          line.unitCostCents,
          line.markupRateBasisPoints,
          line.taxable ? 1 : 0,
          line.taxCode,
          line.ownerVisible ? 1 : 0,
          line.sortOrder
        )
      )
    }
    const results = await access.env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Estimate template revision creation failed.")
    }
    revalidateTemplates(templateId)
    return { success: true, id: templateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create the template revision.",
    }
  }
}

export async function createProjectEstimateFromTemplate(input: {
  readonly projectId: string
  readonly templateId: string
  readonly defaultTaxEntityId: string | null
}): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    await assertProjectAccess(access.db, access.user, input.projectId)
    const project = await access.db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, access.organizationId)
        )
      )
      .get()
    if (!project) throw new Error("Project not found or access denied.")
    const template = await access.db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, access.organizationId),
          eq(projectTemplates.templateKind, "estimate"),
          eq(projectTemplates.lifecycleStatus, "active"),
          eq(projectTemplates.reviewStatus, "verified")
        )
      )
      .get()
    if (!template || template.currentVersionNumber === null) {
      throw new Error("Choose a published estimate template.")
    }
    const version = await access.db
      .select()
      .from(projectTemplateVersions)
      .where(
        and(
          eq(projectTemplateVersions.templateId, template.id),
          eq(
            projectTemplateVersions.versionNumber,
            template.currentVersionNumber
          ),
          eq(projectTemplateVersions.status, "published")
        )
      )
      .get()
    if (!version) throw new Error("The estimate template is not published.")
    const [defaults, sourceLines, taxEntities, priorEstimate] =
      await Promise.all([
        access.db
          .select()
          .from(estimateTemplateDefaults)
          .where(eq(estimateTemplateDefaults.versionId, version.id))
          .get(),
        access.db
          .select()
          .from(estimateTemplateLines)
          .where(eq(estimateTemplateLines.versionId, version.id))
          .orderBy(
            asc(estimateTemplateLines.divisionCode),
            asc(estimateTemplateLines.sortOrder)
          ),
        access.db
          .select()
          .from(sageTaxEntities)
          .where(eq(sageTaxEntities.active, true)),
        access.db
          .select({ versionNumber: projectEstimates.versionNumber })
          .from(projectEstimates)
          .where(eq(projectEstimates.projectId, input.projectId))
          .orderBy(desc(projectEstimates.versionNumber))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ])
    if (!defaults) throw new Error("The estimate template defaults are missing.")
    const defaultTax = cleanText(input.defaultTaxEntityId)
      ? taxEntities.find((tax) => tax.id === input.defaultTaxEntityId) ?? null
      : null
    if (input.defaultTaxEntityId && !defaultTax) {
      throw new Error("Choose an active Sage tax entity.")
    }
    const application = buildEstimateTemplateApplication({
      lines: sourceLines.map(
        (line): EstimateTemplateSourceLine => ({
          id: line.id,
          divisionCode: line.divisionCode,
          divisionName: line.divisionName,
          costCode: line.costCode,
          costCodeName: line.costCodeName,
          description: line.description,
          specifications: line.specifications,
          quantity: line.quantity,
          unit: line.unit,
          unitCostCents: line.unitCostCents,
          markupRateBasisPoints: line.markupRateBasisPoints,
          taxable: line.taxable,
          taxCode: line.taxCode,
          ownerVisible: line.ownerVisible,
          sortOrder: line.sortOrder,
        })
      ),
      taxEntities: taxEntities.map((tax) => ({
        id: tax.id,
        code: tax.code,
        name: tax.name,
        rateBasisPoints: tax.rateBasisPoints,
      })),
      defaultTaxEntityId: defaultTax?.id ?? null,
    })
    if (!application.success) throw new Error(application.error)

    const estimateId = crypto.randomUUID()
    const applicationId = crypto.randomUUID()
    const now = new Date().toISOString()
    const estimateDate = now.slice(0, 10)
    const estimateVersion = (priorEstimate?.versionNumber ?? 0) + 1
    const statements: D1PreparedStatement[] = [
      access.env.DB.prepare(
        `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applying', ?, ?, 0, ?, ?)`
      ).bind(
        applicationId,
        access.organizationId,
        input.projectId,
        template.id,
        version.id,
        estimateDate,
        access.user.id,
        application.data.lines.length,
        JSON.stringify({ moduleType: "estimate" }),
        now
      ),
      access.env.DB.prepare(
        `INSERT INTO project_estimates (
          id, project_id, estimate_number, version_number, title, status,
          estimate_date, source_system, source_revision, template_version_id,
          template_application_id, default_tax_entity_id, default_tax_code,
          default_tax_name, default_tax_rate_basis_points, contract_terms,
          direct_cost_cents, markup_cents, tax_cents, estimate_total_cents,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, 'compass_template', ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        estimateId,
        input.projectId,
        `${project.projectNumber ?? "PROJECT"}-00`,
        estimateVersion,
        defaults.documentTitle,
        estimateDate,
        `${template.name} v${version.versionNumber}`,
        version.id,
        applicationId,
        defaultTax?.id ?? null,
        defaultTax?.code ?? null,
        defaultTax?.name ?? null,
        defaultTax?.rateBasisPoints ?? 0,
        defaults.contractTerms,
        application.data.totals.directCostCents,
        application.data.totals.markupCents,
        application.data.totals.taxCents,
        application.data.totals.estimateTotalCents,
        access.user.id,
        now,
        now
      ),
    ]
    for (const line of application.data.lines) {
      statements.push(
        access.env.DB.prepare(
          `INSERT INTO project_estimate_lines (
            id, project_id, estimate_id, template_line_id, division_code,
            division_name, cost_code, cost_code_name, description,
            specifications, quantity, unit, unit_cost_cents, direct_cost_cents,
            markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
            tax_code, tax_name, tax_rate_basis_points, tax_cents,
            line_total_cents, owner_visible, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          input.projectId,
          estimateId,
          line.templateLineId,
          line.divisionCode,
          line.divisionName,
          line.costCode,
          line.costCodeName,
          line.description,
          line.specifications,
          line.quantity,
          line.unit,
          line.unitCostCents,
          line.directCostCents,
          line.markupRateBasisPoints,
          line.markupCents,
          line.taxable ? 1 : 0,
          line.taxEntityId,
          line.taxCode,
          line.taxName,
          line.taxRateBasisPoints,
          line.taxCents,
          line.lineTotalCents,
          line.ownerVisible ? 1 : 0,
          line.sortOrder,
          now,
          now
        )
      )
    }
    statements.push(
      access.env.DB.prepare(
        `UPDATE project_template_applications
         SET status = 'applied', completed_at = ? WHERE id = ?`
      ).bind(now, applicationId)
    )
    const results = await access.env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Estimate template application failed.")
    }
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId: input.projectId,
      actor: access.user,
      category: "financial",
      action: "estimate.template_applied",
      entityType: "project_estimate",
      entityId: estimateId,
      summary: `Created an estimate from template “${template.name}”.`,
      metadata: {
        templateId: template.id,
        templateVersion: version.versionNumber,
        lineCount: application.data.lines.length,
      },
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/estimate`)
    revalidatePath(`/dashboard/projects/${input.projectId}/financials`)
    revalidateTemplates(template.id)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create an estimate from the template.",
    }
  }
}
