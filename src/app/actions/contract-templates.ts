"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  contractDocumentTemplates,
  contractDocumentTemplateVersions,
} from "@/db/schema-contracts"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { syncContractTemplateVersionToDrive } from "@/lib/contracts/drive-store"
import {
  ORC_CONTRACT_SOURCE_DEFINITIONS,
  ORC_CONTRACT_SOURCE_URL,
  ORC_CONTRACT_SOURCE_WORKBOOK_ID,
  contractSourceRanges,
  normalizeContractSourceDocument,
  type ContractInclusionMode,
  type ContractSigningStage,
  type ContractSourceRows,
} from "@/lib/contracts/source"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

const WARRANTY_MANUAL_URL =
  "https://drive.google.com/file/d/1ArwPZO9qH1sLkKkSHftK9nNg6hHCkj95/view"

export type ContractTemplateLibraryItem = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly category: string
  readonly signingStage: string
  readonly defaultInclusionMode: string
  readonly departmentCodes: readonly string[]
  readonly sourceUrl: string | null
  readonly sortOrder: number
  readonly active: boolean
  readonly version: {
    readonly id: string
    readonly versionNumber: number
    readonly status: string
    readonly contentMarkdown: string
    readonly sourceCapturedAt: string | null
    readonly driveDocumentUrl: string | null
    readonly changeNote: string | null
  } | null
}

export type ContractTemplateActionResult =
  | { readonly success: true; readonly id: string; readonly message: string }
  | { readonly success: false; readonly error: string }

function cleanText(value: string | null, label: string): string {
  const cleaned = value?.trim() ?? ""
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function templateStage(value: string | null): ContractSigningStage {
  if (
    value === "contract" ||
    value === "construction" ||
    value === "closeout" ||
    value === "reference"
  ) {
    return value
  }
  throw new Error("Choose a supported signing stage.")
}

function inclusionMode(value: string | null): ContractInclusionMode {
  if (value === "embedded" || value === "reference" || value === "generated") {
    return value
  }
  throw new Error("Choose a supported inclusion mode.")
}

function stringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function templateManagementContext(): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly organizationId: string
}> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  requirePermission(user, "budget", "update")
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Contract template management is limited to internal staff.")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), env, user, organizationId }
}

export async function getContractTemplateLibrary(): Promise<
  readonly ContractTemplateLibraryItem[]
> {
  const user = await requireAuth()
  requirePermission(user, "budget", "read")
  if (!isInternalStaffRole(user.role)) return []
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const templates = await db
    .select()
    .from(contractDocumentTemplates)
    .where(
      and(
        eq(contractDocumentTemplates.organizationId, organizationId),
        eq(contractDocumentTemplates.active, true)
      )
    )
    .orderBy(
      asc(contractDocumentTemplates.sortOrder),
      asc(contractDocumentTemplates.code)
    )
  const ids = templates.map((template) => template.id)
  const versions =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(contractDocumentTemplateVersions)
          .where(inArray(contractDocumentTemplateVersions.templateId, ids))
          .orderBy(
            desc(contractDocumentTemplateVersions.versionNumber),
            desc(contractDocumentTemplateVersions.updatedAt)
          )
  return templates.map((template) => {
    const version = versions.find((candidate) => candidate.templateId === template.id)
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      category: template.category,
      signingStage: template.signingStage,
      defaultInclusionMode: template.defaultInclusionMode,
      departmentCodes: stringArray(template.departmentCodesJson),
      sourceUrl: template.sourceUrl,
      sortOrder: template.sortOrder,
      active: template.active,
      version: version
        ? {
            id: version.id,
            versionNumber: version.versionNumber,
            status: version.status,
            contentMarkdown: version.contentMarkdown,
            sourceCapturedAt: version.sourceCapturedAt,
            driveDocumentUrl: version.driveDocumentUrl,
            changeNote: version.changeNote,
          }
        : null,
    }
  })
}

export async function importOrcContractTemplateLibrary(): Promise<
  ContractTemplateActionResult
> {
  try {
    const context = await templateManagementContext()
    const auth = await context.db
      .select({ key: googleAuth.serviceAccountKeyEncrypted })
      .from(googleAuth)
      .where(eq(googleAuth.organizationId, context.organizationId))
      .get()
    if (!auth) throw new Error("Connect Google Workspace before importing contracts.")
    const config = getGoogleConfig(context.env)
    const keyJson = await decrypt(
      auth.key,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const sheets = new SheetsClient(parseServiceAccountKey(keyJson))
    const userEmail = context.user.googleEmail ?? context.user.email
    const metadata = await sheets.getSpreadsheetMetadata(
      userEmail,
      ORC_CONTRACT_SOURCE_WORKBOOK_ID
    )
    const visibleTitles = new Set(
      metadata.sheets.filter((sheet) => !sheet.hidden).map((sheet) => sheet.title)
    )
    const ranges = contractSourceRanges()
    const missing = ranges
      .map((item) => item.sheetName)
      .filter((sheetName) => !visibleTitles.has(sheetName))
    if (missing.length > 0) {
      throw new Error(`The contract source is missing: ${missing.join(", ")}.`)
    }
    const rangeRows = await Promise.all(
      ranges.map(async (item) => ({
        sheetName: item.sheetName,
        rows: await sheets.getValues(userEmail, {
          spreadsheetId: ORC_CONTRACT_SOURCE_WORKBOOK_ID,
          range: item.range,
          valueRenderOption: "FORMATTED_VALUE",
        }),
      }))
    )
    const rows: ContractSourceRows = Object.fromEntries(
      rangeRows.map((item) => [item.sheetName, item.rows])
    )
    const drive = await getOrganizationDriveContext({
      db: context.db,
      environment: context.env,
      organizationId: context.organizationId,
      user: context.user,
    })
    const now = new Date().toISOString()
    let created = 0
    let refreshed = 0
    let unchanged = 0
    let lastId = "contract-library"

    for (const definition of ORC_CONTRACT_SOURCE_DEFINITIONS) {
      const contentMarkdown = normalizeContractSourceDocument({ definition, rows })
      if (!contentMarkdown) {
        throw new Error(`${definition.code} did not produce contract content.`)
      }
      const fingerprint = await sha256(contentMarkdown)
      const existing = await context.db
        .select()
        .from(contractDocumentTemplates)
        .where(
          and(
            eq(contractDocumentTemplates.organizationId, context.organizationId),
            eq(contractDocumentTemplates.code, definition.code)
          )
        )
        .get()
      const templateId = existing?.id ?? crypto.randomUUID()
      lastId = templateId
      const versions = existing
        ? await context.db
            .select()
            .from(contractDocumentTemplateVersions)
            .where(eq(contractDocumentTemplateVersions.templateId, templateId))
            .orderBy(desc(contractDocumentTemplateVersions.versionNumber))
        : []
      const latest = versions[0]
      if (latest?.sourceFingerprint === fingerprint) {
        unchanged += 1
        continue
      }
      const versionNumber = (latest?.versionNumber ?? 0) + 1
      const versionId = crypto.randomUUID()
      const driveFile = await syncContractTemplateVersionToDrive({
        client: drive.client,
        userEmail: drive.userEmail,
        currentFileId: null,
        code: definition.code,
        name: definition.name,
        versionNumber,
        contentMarkdown,
      })
      if (!existing) {
        await context.db
          .insert(contractDocumentTemplates)
          .values({
            id: templateId,
            organizationId: context.organizationId,
            code: definition.code,
            name: definition.name,
            category: definition.category,
            signingStage: definition.signingStage,
            defaultInclusionMode: definition.defaultInclusionMode,
            departmentCodesJson: JSON.stringify(["O", "D", "H", "N"]),
            sourceWorkbookId:
              definition.sheetNames.length > 0
                ? ORC_CONTRACT_SOURCE_WORKBOOK_ID
                : null,
            sourceSheetNamesJson: JSON.stringify(definition.sheetNames),
            sourceUrl:
              definition.code === "CA18"
                ? WARRANTY_MANUAL_URL
                : definition.code === "CA22"
                  ? null
                  : ORC_CONTRACT_SOURCE_URL,
            sortOrder: definition.sortOrder,
            active: true,
            createdBy: context.user.id,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        created += 1
      } else {
        await context.db
          .update(contractDocumentTemplates)
          .set({
            name: definition.name,
            category: definition.category,
            signingStage: definition.signingStage,
            defaultInclusionMode: definition.defaultInclusionMode,
            sourceSheetNamesJson: JSON.stringify(definition.sheetNames),
            sourceUrl:
              definition.code === "CA18"
                ? WARRANTY_MANUAL_URL
                : definition.code === "CA22"
                  ? null
                  : ORC_CONTRACT_SOURCE_URL,
            sortOrder: definition.sortOrder,
            active: true,
            updatedAt: now,
          })
          .where(eq(contractDocumentTemplates.id, templateId))
          .run()
        refreshed += 1
      }
      await context.db
        .insert(contractDocumentTemplateVersions)
        .values({
          id: versionId,
          templateId,
          versionNumber,
          status: existing ? "draft" : "published",
          contentMarkdown,
          sourceFingerprint: fingerprint,
          sourceCapturedAt: now,
          driveDocumentId: driveFile.fileId,
          driveDocumentUrl: driveFile.fileUrl,
          changeNote: existing
            ? "Refreshed from the approved Google Sheets source."
            : "Initial approved source import.",
          createdBy: context.user.id,
          publishedBy: existing ? null : context.user.id,
          publishedAt: existing ? null : now,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    revalidatePath("/dashboard/templates")
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: lastId,
      message: `${created} created, ${refreshed} refreshed as drafts, ${unchanged} unchanged.`,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to import the contract library.",
    }
  }
}

export async function createContractTemplateDraft(input: {
  readonly code: string | null
  readonly name: string | null
  readonly contentMarkdown: string | null
}): Promise<ContractTemplateActionResult> {
  try {
    const context = await templateManagementContext()
    const code = cleanText(input.code, "Document code").toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) {
      throw new Error("Document code must use 2–20 letters, numbers, or hyphens.")
    }
    const name = cleanText(input.name, "Document name")
    const contentMarkdown = cleanText(input.contentMarkdown, "Document content")
    const existing = await context.db
      .select({ id: contractDocumentTemplates.id })
      .from(contractDocumentTemplates)
      .where(
        and(
          eq(contractDocumentTemplates.organizationId, context.organizationId),
          eq(contractDocumentTemplates.code, code)
        )
      )
      .get()
    if (existing) throw new Error(`${code} already exists in the Contract Library.`)
    const drive = await getOrganizationDriveContext({
      db: context.db,
      environment: context.env,
      organizationId: context.organizationId,
      user: context.user,
    })
    const driveFile = await syncContractTemplateVersionToDrive({
      client: drive.client,
      userEmail: drive.userEmail,
      currentFileId: null,
      code,
      name,
      versionNumber: 1,
      contentMarkdown,
    })
    const templateId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    await context.db.batch([
      context.db.insert(contractDocumentTemplates).values({
        id: templateId,
        organizationId: context.organizationId,
        code,
        name,
        category: "exhibit",
        signingStage: "contract",
        defaultInclusionMode: "embedded",
        departmentCodesJson: JSON.stringify(["O", "D", "H", "N"]),
        sortOrder: 1_000,
        active: true,
        createdBy: context.user.id,
        createdAt: now,
        updatedAt: now,
      }),
      context.db.insert(contractDocumentTemplateVersions).values({
        id: versionId,
        templateId,
        versionNumber: 1,
        status: "draft",
        contentMarkdown,
        driveDocumentId: driveFile.fileId,
        driveDocumentUrl: driveFile.fileUrl,
        changeNote: "New Compass contract document.",
        createdBy: context.user.id,
        createdAt: now,
        updatedAt: now,
      }),
    ])
    revalidatePath("/dashboard/templates")
    return {
      success: true,
      id: templateId,
      message: `${code} draft created. Review and publish it before project use.`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to create contract document.",
    }
  }
}

export async function saveContractTemplateDraft(input: {
  readonly templateId: string
  readonly name: string | null
  readonly category: string | null
  readonly signingStage: string | null
  readonly inclusionMode: string | null
  readonly contentMarkdown: string | null
  readonly changeNote: string | null
}): Promise<ContractTemplateActionResult> {
  try {
    const context = await templateManagementContext()
    const template = await context.db
      .select()
      .from(contractDocumentTemplates)
      .where(
        and(
          eq(contractDocumentTemplates.id, input.templateId),
          eq(contractDocumentTemplates.organizationId, context.organizationId),
          eq(contractDocumentTemplates.active, true)
        )
      )
      .get()
    if (!template) throw new Error("Contract template not found.")
    const versions = await context.db
      .select()
      .from(contractDocumentTemplateVersions)
      .where(eq(contractDocumentTemplateVersions.templateId, template.id))
      .orderBy(desc(contractDocumentTemplateVersions.versionNumber))
    const latest = versions[0]
    if (!latest) throw new Error("Contract template version not found.")
    const name = cleanText(input.name, "Document name")
    const category = cleanText(input.category, "Category")
    const signingStage = templateStage(input.signingStage)
    const defaultInclusionMode = inclusionMode(input.inclusionMode)
    const contentMarkdown = cleanText(input.contentMarkdown, "Document content")
    const now = new Date().toISOString()
    const draftId = latest.status === "draft" ? latest.id : crypto.randomUUID()
    const draftNumber =
      latest.status === "draft" ? latest.versionNumber : latest.versionNumber + 1
    const drive = await getOrganizationDriveContext({
      db: context.db,
      environment: context.env,
      organizationId: context.organizationId,
      user: context.user,
    })
    const driveFile = await syncContractTemplateVersionToDrive({
      client: drive.client,
      userEmail: drive.userEmail,
      currentFileId: latest.status === "draft" ? latest.driveDocumentId : null,
      code: template.code,
      name,
      versionNumber: draftNumber,
      contentMarkdown,
    })
    await context.db
      .update(contractDocumentTemplates)
      .set({
        name,
        category,
        signingStage,
        defaultInclusionMode,
        updatedAt: now,
      })
      .where(eq(contractDocumentTemplates.id, template.id))
      .run()
    if (latest.status === "draft") {
      await context.db
        .update(contractDocumentTemplateVersions)
        .set({
          contentMarkdown,
          driveDocumentId: driveFile.fileId,
          driveDocumentUrl: driveFile.fileUrl,
          changeNote: input.changeNote?.trim() || null,
          updatedAt: now,
        })
        .where(eq(contractDocumentTemplateVersions.id, draftId))
        .run()
    } else {
      await context.db
        .insert(contractDocumentTemplateVersions)
        .values({
          id: draftId,
          templateId: template.id,
          versionNumber: draftNumber,
          status: "draft",
          contentMarkdown,
          sourceFingerprint: null,
          sourceCapturedAt: null,
          driveDocumentId: driveFile.fileId,
          driveDocumentUrl: driveFile.fileUrl,
          changeNote: input.changeNote?.trim() || null,
          createdBy: context.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }
    revalidatePath("/dashboard/templates")
    return { success: true, id: template.id, message: `Draft v${draftNumber} saved.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save contract draft.",
    }
  }
}

export async function publishContractTemplateVersion(
  templateId: string,
  versionId: string
): Promise<ContractTemplateActionResult> {
  try {
    const context = await templateManagementContext()
    const rows = await context.db
      .select({ version: contractDocumentTemplateVersions })
      .from(contractDocumentTemplateVersions)
      .innerJoin(
        contractDocumentTemplates,
        eq(contractDocumentTemplates.id, contractDocumentTemplateVersions.templateId)
      )
      .where(
        and(
          eq(contractDocumentTemplates.id, templateId),
          eq(contractDocumentTemplates.organizationId, context.organizationId),
          eq(contractDocumentTemplateVersions.id, versionId),
          eq(contractDocumentTemplateVersions.status, "draft")
        )
      )
      .limit(1)
    const version = rows[0]?.version
    if (!version) throw new Error("Choose an unpublished contract draft.")
    const now = new Date().toISOString()
    await context.db
      .update(contractDocumentTemplateVersions)
      .set({
        status: "published",
        publishedBy: context.user.id,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(contractDocumentTemplateVersions.id, version.id))
      .run()
    revalidatePath("/dashboard/templates")
    revalidatePath("/dashboard/projects")
    return {
      success: true,
      id: templateId,
      message: `Version ${version.versionNumber} published.`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to publish contract template.",
    }
  }
}

export async function archiveContractTemplate(
  templateId: string
): Promise<ContractTemplateActionResult> {
  try {
    const context = await templateManagementContext()
    const template = await context.db
      .select({ id: contractDocumentTemplates.id })
      .from(contractDocumentTemplates)
      .where(
        and(
          eq(contractDocumentTemplates.id, templateId),
          eq(contractDocumentTemplates.organizationId, context.organizationId)
        )
      )
      .get()
    if (!template) throw new Error("Contract template not found.")
    await context.db
      .update(contractDocumentTemplates)
      .set({ active: false, updatedAt: new Date().toISOString() })
      .where(eq(contractDocumentTemplates.id, template.id))
      .run()
    revalidatePath("/dashboard/templates")
    return {
      success: true,
      id: template.id,
      message: "Contract template archived. Existing packets retain their snapshot.",
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to archive contract template.",
    }
  }
}
