"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { sageCostCodes } from "@/db/schema"
import { sageTaxEntities } from "@/db/schema-estimates"
import {
  estimateTemplateDefaults,
  estimateTemplateLines,
  projectTemplateModules,
  projectTemplates,
  projectTemplateVersions,
} from "@/db/schema-templates"
import { recordActivityEvent } from "@/lib/activity-log"
import { isDemoUser } from "@/lib/demo"
import { createEstimateFromTemplate } from "@/lib/domain/templates/estimate-template-apply"
import {
  editableTemplateVersion,
  findEstimateTemplate,
  latestTemplateVersion,
  loadEstimateTemplateEditor,
  loadPublishedEstimateTemplateOptions,
} from "@/lib/domain/templates/estimate-template-reads"
import { nonNegative, requiredText } from "@/lib/domain/templates/rules"
import {
  deleteEstimateTemplateLines,
  estimateTemplateDraftStatements,
  estimateTemplateRevisionStatements,
  insertEstimateTemplateLine,
  updateEstimateTemplateDefaultsStatement,
  updateEstimateTemplateLines,
  updateTemplateModules,
  updateTemplateModulesStatement,
  updateTemplates,
  updateTemplatesStatement,
  updateTemplateVersionsStatement,
} from "@/lib/domain/templates/store"
import type {
  EstimateTemplateEditor,
  EstimateTemplateLineInput,
  EstimateTemplateOption,
} from "@/lib/domain/templates/types"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import { can, requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { orgContext, type OrgContext } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { isInternalStaffRole } from "@/lib/user-roles"

export type {
  EstimateTemplateEditor,
  EstimateTemplateEditorLine,
  EstimateTemplateLineInput,
  EstimateTemplateOption,
} from "@/lib/domain/templates/types"

type ActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

function ensureInternal(role: string): void {
  if (!isInternalStaffRole(role)) {
    throw new Error("Template management is limited to internal staff.")
  }
}

/**
 * The shared org context plus the rules this area always had: budget
 * permission, internal staff only, and no demo-user writes. Failures are
 * thrown with the same messages for the callers' catch blocks.
 */
async function templateAccess(action: "read" | "update"): Promise<OrgContext> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  const { user } = context.data
  requirePermission(user, "budget", action)
  ensureInternal(user.role)
  if (action === "update" && isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  return context.data
}

function revalidateTemplates(templateId?: string): void {
  revalidatePath("/dashboard/templates")
  if (templateId) revalidatePath(`/dashboard/templates/${templateId}`)
}

export async function getPublishedEstimateTemplateOptions(): Promise<
  readonly EstimateTemplateOption[]
> {
  const access = await templateAccess("read")
  return loadPublishedEstimateTemplateOptions(access.db, access.organizationId)
}

export async function getEstimateTemplateEditor(
  templateId: string
): Promise<EstimateTemplateEditor | null> {
  const access = await templateAccess("read")
  return loadEstimateTemplateEditor(
    access.db,
    access.organizationId,
    templateId,
    can(access.user, "budget", "update")
  )
}

export async function createEstimateTemplateDraft(input: {
  readonly name: string | null
  readonly description: string | null
}): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const id = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const results = await access.env.DB.batch(
      estimateTemplateDraftStatements(access.env.DB, {
        id,
        versionId,
        moduleId: crypto.randomUUID(),
        organizationId: access.organizationId,
        name: requiredText(input.name, "Template name"),
        description: cleanText(input.description),
        createdBy: access.user.id,
        now,
      })
    )
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
  readonly documentTitle: string | null
  readonly contractTerms: string | null
  readonly defaultMarkupPercent: number | null
}): Promise<ActionResult> {
  try {
    const access = await templateAccess("update")
    const { version } = await editableTemplateVersion(access.db, access.organizationId, input.templateId)
    const markupPercent = nonNegative(input.defaultMarkupPercent, 0)
    const now = new Date().toISOString()
    await access.db.batch([
      updateTemplatesStatement(access.db, eq(projectTemplates.id, input.templateId), {
        name: requiredText(input.name, "Template name"),
        description: cleanText(input.description),
        updatedAt: now,
      }),
      updateEstimateTemplateDefaultsStatement(access.db, eq(estimateTemplateDefaults.versionId, version.id), {
        documentTitle: requiredText(input.documentTitle, "Document title"),
        contractTerms: cleanText(input.contractTerms),
        defaultMarkupRateBasisPoints: Math.round(markupPercent * 100),
      }),
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
    const { version } = await editableTemplateVersion(access.db, access.organizationId, templateId)
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
      await updateEstimateTemplateLines(access.db, eq(estimateTemplateLines.id, existing.id), values)
    } else {
      await insertEstimateTemplateLine(access.db, { id, ...values })
    }
    const count = await access.db
      .select({ id: estimateTemplateLines.id })
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
    await updateTemplateModules(
      access.db,
      and(
        eq(projectTemplateModules.versionId, version.id),
        eq(projectTemplateModules.moduleType, "estimate")
      ),
      { sourceItemCount: count.length, normalizationStatus: "draft" }
    )
    await updateTemplates(access.db, eq(projectTemplates.id, templateId), { updatedAt: now })
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
    const { version } = await editableTemplateVersion(access.db, access.organizationId, templateId)
    await deleteEstimateTemplateLines(
      access.db,
      and(
        eq(estimateTemplateLines.id, lineId),
        eq(estimateTemplateLines.versionId, version.id)
      )
    )
    const count = await access.db
      .select({ id: estimateTemplateLines.id })
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
    await updateTemplateModules(
      access.db,
      and(
        eq(projectTemplateModules.versionId, version.id),
        eq(projectTemplateModules.moduleType, "estimate")
      ),
      { sourceItemCount: count.length }
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
    const { version } = await editableTemplateVersion(access.db, access.organizationId, templateId)
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
      updateTemplateVersionsStatement(access.db, eq(projectTemplateVersions.id, version.id), {
        status: "published",
      }),
      updateTemplateModulesStatement(
        access.db,
        and(
          eq(projectTemplateModules.versionId, version.id),
          eq(projectTemplateModules.moduleType, "estimate")
        ),
        { sourceItemCount: lines.length, normalizationStatus: "published" }
      ),
      updateTemplatesStatement(access.db, eq(projectTemplates.id, templateId), {
        lifecycleStatus: "active",
        reviewStatus: "verified",
        currentVersionNumber: version.versionNumber,
        updatedAt: now,
      }),
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
    const template = await findEstimateTemplate(access.db, access.organizationId, templateId)
    if (!template) throw new Error("Estimate template not found.")
    const latest = await latestTemplateVersion(access.db, templateId)
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
    const moduleId = crypto.randomUUID()
    const results = await access.env.DB.batch(
      estimateTemplateRevisionStatements(access.env.DB, {
        templateId,
        versionId,
        moduleId,
        versionNumber: latest.versionNumber + 1,
        notes: `Revision of version ${latest.versionNumber}`,
        createdBy: access.user.id,
        now,
        defaults,
        lines: lines.map((line) => ({ ...line, id: crypto.randomUUID() })),
      })
    )
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
    const created = await createEstimateFromTemplate(
      {
        db: access.db,
        rawDb: access.env.DB,
        organizationId: access.organizationId,
        userId: access.user.id,
      },
      input
    )
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId: input.projectId,
      actor: access.user,
      category: "financial",
      action: "estimate.template_applied",
      entityType: "project_estimate",
      entityId: created.estimateId,
      summary: `Created an estimate from template “${created.templateName}”.`,
      metadata: {
        templateId: created.templateId,
        templateVersion: created.versionNumber,
        lineCount: created.lineCount,
      },
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/estimate`)
    revalidatePath(`/dashboard/projects/${input.projectId}/financials`)
    revalidateTemplates(created.templateId)
    return { success: true, id: created.estimateId }
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
