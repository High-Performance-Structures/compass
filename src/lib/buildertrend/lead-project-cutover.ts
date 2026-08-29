import { z } from "zod/v4"

import {
  buildBuildertrendStagingSql,
  type BuildertrendStagingManifest,
} from "./staging-manifest"
import {
  buildBuildertrendInventoryManifest,
  isTrustedBuildertrendUrl,
} from "./inventory-manifest"

const textField = z.string().trim().min(1).optional()
const nullableTextField = z.string().trim().min(1).nullable().optional()

const leadSchema = z
  .object({
    buildertrendLeadId: textField,
    leadId: textField,
    stableProjectKey: textField,
    projectKey: textField,
    existingProjectId: textField,
    compassProjectId: textField,
    projectName: textField,
    projectNumber: nullableTextField,
    googleDriveProjectFolderId: textField,
    googleDriveFolderId: textField,
    title: textField,
    name: textField,
    href: textField,
    buildertrendUrl: textField,
    clientName: nullableTextField,
    contactName: nullableTextField,
    contactEmail: nullableTextField,
    contactPhone: nullableTextField,
    status: nullableTextField,
    sourceStatus: nullableTextField,
    contacts: z.array(z.unknown()).optional(),
  })
  .passthrough()

const inputSchema = z
  .object({
    runKey: z.string().trim().min(1),
    sourceMethod: z.string().trim().min(1).optional(),
    sourceLabel: z.string().trim().min(1),
    capturedAt: z.iso.datetime({ offset: true }),
    rawArtifactDriveFileId: textField,
    rawArtifactDriveUrl: textField,
    notes: textField,
    leads: z.array(leadSchema).optional(),
    rows: z.array(leadSchema).optional(),
  })
  .passthrough()

export type BuildertrendLeadProjectCutoverInput = z.infer<
  typeof inputSchema
>

export type BuildertrendLeadProjectCutoverSummary = {
  readonly runKey: string
  readonly leadCount: number
  readonly projectCount: number
  readonly newProjectCount: number
  readonly existingProjectLinkCount: number
  readonly accessCandidateCount: number
}

export type BuildertrendLeadProjectCutoverBuild = {
  readonly sql: string
  readonly statements: readonly string[]
  readonly summary: BuildertrendLeadProjectCutoverSummary
}

export type BuildertrendLeadProjectCutoverParseResult =
  | {
      readonly success: true
      readonly data: BuildertrendLeadProjectCutoverInput
    }
  | {
      readonly success: false
      readonly errors: readonly string[]
    }

type LeadInput = NonNullable<
  BuildertrendLeadProjectCutoverInput["leads"]
>[number]

type ProjectPlan = {
  readonly stableProjectKey: string
  readonly projectId: string
  readonly existingProjectId: string | undefined
  readonly projectName: string
  readonly projectNumber: string | undefined
  readonly googleDriveProjectFolderId: string | undefined
  readonly clientName: string | undefined
}

type LeadPlan = {
  readonly lead: LeadInput
  readonly project: ProjectPlan
}

function normalizedText(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined
}

function firstText(...values: readonly (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    const normalized = normalizedText(value)
    if (normalized) return normalized
  }
  return undefined
}

function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

function stableKey(value: string): string {
  return value.trim().toLowerCase()
}

function stableProjectId(organizationId: string, projectKey: string): string {
  return `buildertrend-lead-project:${organizationId}:${projectKey}`
}

function aliasesMatch(
  label: string,
  values: readonly (string | null | undefined)[],
  errors: string[],
): string | undefined {
  const normalized = values
    .map((value) => normalizedText(value))
    .filter((value): value is string => value !== undefined)
  const unique = [...new Set(normalized)]
  if (unique.length > 1) {
    errors.push(`${label} aliases disagree`)
    return undefined
  }
  return unique[0]
}

function leadRows(input: BuildertrendLeadProjectCutoverInput): readonly LeadInput[] {
  const leads = input.leads ?? []
  const rows = input.rows ?? []
  if (leads.length > 0 && rows.length > 0) {
    throw new Error("Provide either leads or rows, not both")
  }
  return leads.length > 0 ? leads : rows
}

function parseInput(value: unknown): BuildertrendLeadProjectCutoverParseResult {
  const parsed = inputSchema.safeParse(value)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) =>
        `${issue.path.length > 0 ? issue.path.join(".") : "input"}: ${issue.message}`
      ),
    }
  }

  let rows: readonly LeadInput[]
  try {
    rows = leadRows(parsed.data)
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
  if (rows.length === 0) {
    return { success: false, errors: ["leads must contain at least one row"] }
  }

  const errors: string[] = []
  const leadIds = new Set<string>()
  const projectKeys = new Set<string>()
  for (const [index, lead] of rows.entries()) {
    const leadId = aliasesMatch(
      `leads.${index}.buildertrendLeadId`,
      [lead.buildertrendLeadId, lead.leadId],
      errors,
    )
    if (!leadId) {
      errors.push(`leads.${index}: Buildertrend lead ID is required`)
    } else if (!/^\d+$/.test(leadId)) {
      errors.push(`leads.${index}: Buildertrend lead ID must contain only digits`)
    } else if (leadIds.has(leadId)) {
      errors.push(`leads.${index}: duplicate Buildertrend lead ID ${leadId}`)
    } else {
      leadIds.add(leadId)
    }

    const projectKey = aliasesMatch(
      `leads.${index}.stableProjectKey`,
      [lead.stableProjectKey, lead.projectKey],
      errors,
    )
    if (!projectKey) {
      errors.push(`leads.${index}: stableProjectKey is required`)
    } else {
      projectKeys.add(stableKey(projectKey))
    }

    const existingProjectId = aliasesMatch(
      `leads.${index}.existingProjectId`,
      [lead.existingProjectId, lead.compassProjectId],
      errors,
    )
    const driveFolderId = aliasesMatch(
      `leads.${index}.googleDriveProjectFolderId`,
      [lead.googleDriveProjectFolderId, lead.googleDriveFolderId],
      errors,
    )
    if (!existingProjectId && !driveFolderId) {
      errors.push(
        `leads.${index}: googleDriveProjectFolderId is required for a new project`
      )
    }

    const title = firstText(lead.title, lead.name, lead.projectName)
    if (!title) errors.push(`leads.${index}: title or projectName is required`)

    const href = firstText(lead.href, lead.buildertrendUrl)
    if (!href) errors.push(`leads.${index}: href or buildertrendUrl is required`)
    if (href && !isTrustedBuildertrendUrl(href)) {
      errors.push(`leads.${index}: Buildertrend lead URL is not trusted`)
    }

    if (lead.projectNumber !== undefined && lead.projectNumber !== null) {
      const projectNumber = normalizedText(lead.projectNumber)
      if (!projectNumber) errors.push(`leads.${index}: projectNumber cannot be empty`)
    }
    if (lead.projectId && existingProjectId && lead.projectId !== existingProjectId) {
      errors.push(`leads.${index}: projectId conflicts with existingProjectId`)
    }
  }

  if (errors.length > 0) return { success: false, errors }
  return { success: true, data: parsed.data }
}

export function parseBuildertrendLeadProjectCutover(
  value: unknown,
  organizationId: string,
): BuildertrendLeadProjectCutoverParseResult {
  if (!organizationId.trim()) {
    return { success: false, errors: ["organizationId is required"] }
  }
  return parseInput(value)
}

function buildProjectPlans(
  input: BuildertrendLeadProjectCutoverInput,
  organizationId: string,
): { readonly plans: readonly LeadPlan[]; readonly errors: readonly string[] } {
  const errors: string[] = []
  const groups = new Map<string, { readonly lead: LeadInput; readonly index: number }[]>()
  for (const [index, lead] of leadRows(input).entries()) {
    const projectKey = firstText(lead.stableProjectKey, lead.projectKey)
    if (!projectKey) continue
    const key = stableKey(projectKey)
    const current = groups.get(key) ?? []
    current.push({ lead, index })
    groups.set(key, current)
  }

  const projectsByKey = new Map<string, ProjectPlan>()
  for (const [key, entries] of groups.entries()) {
    const first = entries[0]
    if (!first) continue
    const groupErrors: string[] = []
    const existingIds = entries.map(({ lead }) =>
      aliasesMatch("existingProjectId", [lead.existingProjectId, lead.compassProjectId], groupErrors)
    )
    const driveFolders = entries.map(({ lead }) =>
      aliasesMatch(
        "googleDriveProjectFolderId",
        [lead.googleDriveProjectFolderId, lead.googleDriveFolderId],
        groupErrors,
      )
    )
    const projectNumbers = entries
      .map(({ lead }) => normalizedText(lead.projectNumber))
      .filter((value): value is string => value !== undefined)
    const projectNames = entries
      .map(({ lead }) => normalizedText(lead.projectName))
      .filter((value): value is string => value !== undefined)
    const uniqueExistingIds = [...new Set(existingIds.filter((value): value is string => value !== undefined))]
    const uniqueDriveFolders = [...new Set(driveFolders.filter((value): value is string => value !== undefined))]
    const uniqueProjectNumbers = [...new Set(projectNumbers)]
    const uniqueProjectNames = [...new Set(projectNames)]
    if (uniqueExistingIds.length > 1) groupErrors.push("leads in one stableProjectKey must link to one existing project")
    if (uniqueDriveFolders.length > 1) groupErrors.push("leads in one stableProjectKey must use one Google Drive project folder")
    if (uniqueProjectNumbers.length > 1) groupErrors.push("leads in one stableProjectKey must use one project number")
    if (uniqueProjectNames.length > 1) groupErrors.push("leads in one stableProjectKey must use one projectName")

    const existingProjectId = uniqueExistingIds[0]
    const googleDriveProjectFolderId = uniqueDriveFolders[0]
    if (!existingProjectId && !googleDriveProjectFolderId) {
      groupErrors.push("new stableProjectKey groups require a Google Drive project folder")
    }
    const firstTitle = firstText(first.lead.projectName, first.lead.title, first.lead.name)
    if (!firstTitle) groupErrors.push("stableProjectKey group has no project name or lead title")
    if (groupErrors.length > 0) {
      for (const entry of entries) {
        for (const error of groupErrors) errors.push(`leads.${entry.index}: ${error}`)
      }
      continue
    }

    const project: ProjectPlan = {
      stableProjectKey: key,
      projectId: existingProjectId ?? stableProjectId(organizationId, key),
      existingProjectId,
      projectName: uniqueProjectNames[0] ?? firstTitle ?? key,
      projectNumber: uniqueProjectNumbers[0],
      googleDriveProjectFolderId,
      clientName: firstText(first.lead.clientName, first.lead.contactName),
    }
    projectsByKey.set(key, project)
  }

  const plans = leadRows(input).flatMap((lead) => {
    const projectKey = firstText(lead.stableProjectKey, lead.projectKey)
    if (!projectKey) return []
    const project = projectsByKey.get(stableKey(projectKey))
    return project ? [{ lead, project }] : []
  })
  return { plans, errors }
}

function newProjectSql(
  organizationId: string,
  project: ProjectPlan,
  capturedAt: string,
): string {
  return `INSERT INTO projects (
  id, project_number, name, status, client_status, job_status_id, client_name,
  organization_id, google_drive_folder_id, owner_updates_enabled,
  owner_update_channel, owner_update_cadence, owner_schedule_view,
  created_at, updated_at
) SELECT
  ${sqlText(project.projectId)}, ${sqlText(project.projectNumber)},
  ${sqlText(project.projectName)}, 'OPEN', 'lead', 'current',
  ${sqlText(project.clientName)}, ${sqlText(organizationId)},
  ${sqlText(project.googleDriveProjectFolderId)}, 0, 'compass', 'weekly', 'items',
  ${sqlText(capturedAt)}, ${sqlText(capturedAt)}
WHERE EXISTS (
  SELECT 1 FROM organizations WHERE id = ${sqlText(organizationId)}
)
ON CONFLICT(id) DO UPDATE SET
  google_drive_folder_id = COALESCE(
    projects.google_drive_folder_id,
    excluded.google_drive_folder_id
  ),
  updated_at = CASE
    WHEN projects.organization_id = excluded.organization_id
      THEN excluded.updated_at
    ELSE projects.updated_at
  END
WHERE projects.organization_id = excluded.organization_id;`
}

function newProjectCollisionGuardSql(
  organizationId: string,
  project: ProjectPlan,
  capturedAt: string,
): string {
  const projectNumberConflict = project.projectNumber
    ? `OR EXISTS (
    SELECT 1 FROM projects
    WHERE organization_id = ${sqlText(organizationId)}
      AND project_number = ${sqlText(project.projectNumber)} COLLATE NOCASE
      AND id <> ${sqlText(project.projectId)}
  )`
    : ""
  return `-- Fail closed if a new Buildertrend project would reuse an existing identity.
INSERT INTO projects (id, name, status, organization_id, created_at, updated_at)
SELECT NULL, 'Buildertrend cutover collision guard', 'OPEN',
  ${sqlText(organizationId)}, ${sqlText(capturedAt)}, ${sqlText(capturedAt)}
WHERE EXISTS (
  SELECT 1 FROM projects
  WHERE id = ${sqlText(project.projectId)}
    AND organization_id <> ${sqlText(organizationId)}
)
OR EXISTS (
  SELECT 1 FROM projects
  WHERE organization_id = ${sqlText(organizationId)}
    AND google_drive_folder_id = ${sqlText(project.googleDriveProjectFolderId)}
    AND id <> ${sqlText(project.projectId)}
)
${projectNumberConflict};`
}

function projectReferenceGuardSql(
  organizationId: string,
  project: ProjectPlan,
  capturedAt: string,
): string {
  return `-- Fail closed rather than staging a lead against a nonexistent Compass project.
INSERT INTO projects (id, name, status, organization_id, created_at, updated_at)
SELECT NULL, 'Buildertrend cutover project reference guard', 'OPEN',
  ${sqlText(organizationId)}, ${sqlText(capturedAt)}, ${sqlText(capturedAt)}
WHERE NOT EXISTS (
  SELECT 1 FROM projects
  WHERE id = ${sqlText(project.projectId)}
    AND organization_id = ${sqlText(organizationId)}
);`
}

function toInventoryRows(
  input: BuildertrendLeadProjectCutoverInput,
  plans: readonly LeadPlan[],
): readonly Record<string, unknown>[] {
  const planByLeadId = new Map(
    plans.map((plan) => [
      firstText(plan.lead.buildertrendLeadId, plan.lead.leadId) ?? "",
      plan,
    ]),
  )
  const rows = leadRows(input).map((lead) => {
    const leadId = firstText(lead.buildertrendLeadId, lead.leadId)
    const plan = leadId ? planByLeadId.get(leadId) : undefined
    const title = firstText(lead.title, lead.name, lead.projectName)
    const href = firstText(lead.href, lead.buildertrendUrl)
    const topLevelContactName = firstText(lead.contactName, lead.clientName)
    const hasTopLevelContact = Boolean(
      topLevelContactName || lead.contactEmail || lead.contactPhone
    )
    const contacts =
      lead.contacts && lead.contacts.length > 0
        ? lead.contacts
        : hasTopLevelContact
          ? [
              {
                name: topLevelContactName,
                email: lead.contactEmail ?? null,
                phone: lead.contactPhone ?? null,
              },
            ]
          : []
    return {
      ...lead,
      title,
      href,
      projectId: plan?.project.projectId,
      contacts,
      stableProjectKey: plan?.project.stableProjectKey,
      targetProjectId: plan?.project.projectId,
      targetProjectType: plan?.project.existingProjectId ? "existing" : "new",
    }
  })
  return rows
}

export async function buildBuildertrendLeadProjectCutoverSql(
  organizationId: string,
  input: BuildertrendLeadProjectCutoverInput,
): Promise<BuildertrendLeadProjectCutoverBuild> {
  const normalizedOrganizationId = organizationId.trim()
  const parsed = parseBuildertrendLeadProjectCutover(input, normalizedOrganizationId)
  if (!parsed.success) throw new Error(`Invalid Buildertrend lead cutover:\n${parsed.errors.join("\n")}`)
  const projectPlan = buildProjectPlans(parsed.data, normalizedOrganizationId)
  if (projectPlan.errors.length > 0) {
    throw new Error(`Invalid Buildertrend lead cutover:\n${projectPlan.errors.join("\n")}`)
  }

  const inventoryRows = toInventoryRows(parsed.data, projectPlan.plans)
  const inventory = buildBuildertrendInventoryManifest(
    { rows: inventoryRows },
    {
      kind: "lead_opportunities",
      runKey: parsed.data.runKey,
      sourceLabel: parsed.data.sourceLabel,
      capturedAt: parsed.data.capturedAt,
      sourceMethod:
        parsed.data.sourceMethod ?? "buildertrend_live_lead_cutover",
      rawArtifactDriveFileId: parsed.data.rawArtifactDriveFileId,
      rawArtifactDriveUrl: parsed.data.rawArtifactDriveUrl,
      notes: parsed.data.notes,
    },
  )
  if (!inventory.success) {
    throw new Error(`Invalid Buildertrend lead cutover:\n${inventory.errors.join("\n")}`)
  }
  const manifest: BuildertrendStagingManifest = {
    ...inventory.manifest,
    records: inventory.manifest.records.map((record) => record),
    accessCandidates: inventory.manifest.accessCandidates,
  }
  const stagingBuild = await buildBuildertrendStagingSql(normalizedOrganizationId, manifest)
  const uniqueProjects = projectPlan.plans.filter(
    (plan, index, all) =>
      all.findIndex((candidate) => candidate.project.projectId === plan.project.projectId) === index,
  )
  const existingProjectReferenceGuards = uniqueProjects
    .filter((plan) => plan.project.existingProjectId)
    .map((plan) =>
      projectReferenceGuardSql(normalizedOrganizationId, plan.project, parsed.data.capturedAt),
    )
  const newProjectCollisionGuards = uniqueProjects
    .filter((plan) => !plan.project.existingProjectId)
    .map((plan) =>
      newProjectCollisionGuardSql(normalizedOrganizationId, plan.project, parsed.data.capturedAt),
    )
  const newProjectCreations = uniqueProjects
    .filter((plan) => !plan.project.existingProjectId)
    .map((plan) => newProjectSql(normalizedOrganizationId, plan.project, parsed.data.capturedAt))
  const newProjectReferenceGuards = uniqueProjects
    .filter((plan) => !plan.project.existingProjectId)
    .map((plan) =>
      projectReferenceGuardSql(normalizedOrganizationId, plan.project, parsed.data.capturedAt),
    )
  const projectStatements = [
    ...existingProjectReferenceGuards,
    ...newProjectCollisionGuards,
    ...newProjectCreations,
    ...newProjectReferenceGuards,
  ]
  const projectCount = new Set(projectPlan.plans.map((plan) => plan.project.projectId)).size
  const summary: BuildertrendLeadProjectCutoverSummary = {
    runKey: parsed.data.runKey,
    leadCount: projectPlan.plans.length,
    projectCount,
    newProjectCount: new Set(
      projectPlan.plans
        .filter((plan) => !plan.project.existingProjectId)
        .map((plan) => plan.project.projectId),
    ).size,
    existingProjectLinkCount: new Set(
      projectPlan.plans
        .filter((plan) => plan.project.existingProjectId)
        .map((plan) => plan.project.projectId),
    ).size,
    accessCandidateCount: inventory.summary.accessCandidateCount,
  }
  const sql = [
    "-- Buildertrend live lead-to-project cutover generated by Compass.",
    "-- New projects are deterministic per organization and stable project key.",
    "-- All Buildertrend leads remain review-only staging records.",
    "-- No portal access, notifications, operational promotion, or Sage writes are generated.",
    `-- Input summary: ${JSON.stringify(summary)}`,
    ...projectStatements,
    stagingBuild.sql,
  ].join("\n")
  return {
    sql,
    statements: [...projectStatements, ...stagingBuild.statements],
    summary,
  }
}
