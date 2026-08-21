"use server"

import { and, asc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { estimateTermsTemplates } from "@/db/schema-estimates"
import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { getCloudflareContext } from "@/lib/db"
import {
  BUILT_IN_ESTIMATE_TEXT_TEMPLATES,
  isEstimateTextTemplateType,
  mergeEstimateTextTemplates,
  type EstimateTextTemplateOption,
  type EstimateTextTemplateType,
} from "@/lib/estimates/client-report"
import { syncEstimateTextTemplateToDrive } from "@/lib/estimates/text-template-drive-store"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import type { ProjectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

export type EstimateTextTemplateLibraryItem = EstimateTextTemplateOption & {
  readonly builtIn: boolean
}

export type SaveEstimateTextTemplateLibraryInput = {
  readonly templateId: string | null
  readonly name: string | null
  readonly departmentCode: string | null
  readonly templateType: string | null
  readonly body: string | null
}

type SaveEstimateTextTemplateLibraryResult =
  | {
      readonly success: true
      readonly id: string
      readonly sourceUrl: string
    }
  | { readonly success: false; readonly error: string }

function requiredText(value: string | null, label: string): string {
  const cleaned = value?.trim() ?? ""
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function templateDepartment(value: string | null): ProjectDepartment | null {
  if (!value || value === "all") return null
  if (value === "O" || value === "H" || value === "N" || value === "D") {
    return value
  }
  throw new Error("Choose a supported department.")
}

function databaseTemplateOption(
  row: typeof estimateTermsTemplates.$inferSelect
): EstimateTextTemplateOption | null {
  if (!isEstimateTextTemplateType(row.templateType)) return null
  const departmentCode = templateDepartment(row.departmentCode)
  return {
    id: row.id,
    name: row.name,
    departmentCode,
    templateType: row.templateType,
    body: row.body,
    sourceDocumentId: row.sourceDocumentId,
    sourceUrl: row.sourceUrl,
  }
}

export async function getEstimateTextTemplateLibrary(): Promise<
  readonly EstimateTextTemplateLibraryItem[]
> {
  const user = await requireAuth()
  requirePermission(user, "budget", "read")
  if (!isInternalStaffRole(user.role)) return []
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db
    .select()
    .from(estimateTermsTemplates)
    .where(
      and(
        eq(estimateTermsTemplates.organizationId, organizationId),
        eq(estimateTermsTemplates.active, true)
      )
    )
    .orderBy(
      asc(estimateTermsTemplates.departmentCode),
      asc(estimateTermsTemplates.templateType),
      asc(estimateTermsTemplates.sortOrder),
      asc(estimateTermsTemplates.name)
    )
  const organizationTemplates = rows.flatMap(
    (row): readonly EstimateTextTemplateOption[] => {
      const template = databaseTemplateOption(row)
      return template ? [template] : []
    }
  )
  const merged = mergeEstimateTextTemplates({
    organizationTemplates,
    builtInTemplates: BUILT_IN_ESTIMATE_TEXT_TEMPLATES,
  })
  const databaseIds = new Set(organizationTemplates.map((item) => item.id))
  return merged.map((item) => ({
    ...item,
    builtIn: !databaseIds.has(item.id),
  }))
}

export async function saveEstimateTextTemplateLibraryItem(
  input: SaveEstimateTextTemplateLibraryInput
): Promise<SaveEstimateTextTemplateLibraryResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "budget", "update")
    if (!isInternalStaffRole(user.role)) {
      throw new Error("Template management is limited to internal staff.")
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const builtIn = input.templateId?.startsWith("builtin:")
      ? BUILT_IN_ESTIMATE_TEXT_TEMPLATES.find(
          (candidate) => candidate.id === input.templateId
        ) ?? null
      : null
    if (input.templateId?.startsWith("builtin:") && !builtIn) {
      throw new Error("The built-in template was not found.")
    }

    const current =
      input.templateId && !builtIn
        ? await db
            .select()
            .from(estimateTermsTemplates)
            .where(
              and(
                eq(estimateTermsTemplates.id, input.templateId),
                eq(estimateTermsTemplates.organizationId, organizationId)
              )
            )
            .get()
        : null
    if (input.templateId && !builtIn && !current) {
      throw new Error("The estimate text template was not found.")
    }

    const name = builtIn?.name ?? requiredText(input.name, "Template name")
    const departmentCode =
      builtIn?.departmentCode ?? templateDepartment(input.departmentCode)
    const requestedType =
      builtIn?.templateType ?? requiredText(input.templateType, "Template type")
    if (!isEstimateTextTemplateType(requestedType)) {
      throw new Error("Choose a supported estimate text template type.")
    }
    const templateType: EstimateTextTemplateType = requestedType
    const body = requiredText(input.body, "Template text")

    const identityMatch = await db
      .select()
      .from(estimateTermsTemplates)
      .where(
        and(
          eq(estimateTermsTemplates.organizationId, organizationId),
          departmentCode === null
            ? isNull(estimateTermsTemplates.departmentCode)
            : eq(estimateTermsTemplates.departmentCode, departmentCode),
          eq(estimateTermsTemplates.templateType, templateType),
          eq(estimateTermsTemplates.name, name)
        )
      )
      .get()
    if (current && identityMatch && identityMatch.id !== current.id) {
      throw new Error(
        "A template with this department, type, and name already exists."
      )
    }
    const savedId = current?.id ?? identityMatch?.id ?? crypto.randomUUID()
    const currentFileId =
      current?.sourceDocumentId ?? identityMatch?.sourceDocumentId ??
      builtIn?.sourceDocumentId ?? null
    const drive = await getOrganizationDriveContext({
      db,
      environment: env,
      organizationId,
      user,
    })
    const driveFile = await syncEstimateTextTemplateToDrive({
      client: drive.client,
      userEmail: drive.userEmail,
      currentFileId,
      name,
      departmentCode,
      templateType,
      body,
    })
    const now = new Date().toISOString()
    const existing = current ?? identityMatch
    if (existing) {
      await db
        .update(estimateTermsTemplates)
        .set({
          name,
          departmentCode,
          templateType,
          body,
          sourceDocumentId: driveFile.fileId,
          sourceUrl: driveFile.fileUrl,
          active: true,
          updatedAt: now,
        })
        .where(eq(estimateTermsTemplates.id, existing.id))
        .run()
    } else {
      await db
        .insert(estimateTermsTemplates)
        .values({
          id: savedId,
          organizationId,
          name,
          departmentCode,
          templateType,
          body,
          sourceDocumentId: driveFile.fileId,
          sourceUrl: driveFile.fileUrl,
          active: true,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    revalidatePath("/dashboard/templates")
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: existing?.id ?? savedId,
      sourceUrl: driveFile.fileUrl,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the estimate text template.",
    }
  }
}
