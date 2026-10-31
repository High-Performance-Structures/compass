import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  estimateTemplateDefaults,
  estimateTemplateLines,
  projectTemplateModules,
  projectTemplates,
  projectTemplateVersions,
} from "@/db/schema-templates"
import type { Db } from "@/lib/server/action-context"
import type {
  CapturedScheduleTemplateDependency,
  CapturedScheduleTemplateItem,
} from "@/lib/templates/schedule-template-capture"

import { sqlLiteral as sql } from "./sql-literal"

/*
 * The templates domain store: the only code that inserts, updates or deletes
 * project templates, their versions, modules, applications, application
 * items, schedule template items and dependencies, and estimate template
 * defaults and lines (architecture standard, section 1).
 *
 * Raw-SQL statements keep the exact text, bindings and conflict clauses the
 * actions used before; callers put them in the same `DB.batch` as before.
 * The `*Sql` functions return text for the Buildertrend capture files that
 * are applied with Wrangler. The store has no access rules.
 */

/** One Drizzle statement for `db.batch([...])`. */
type Statement = BatchItem<"sqlite">

// ---- Drizzle writes

type TemplatePatch = SQLiteUpdateSetSource<typeof projectTemplates>
type TemplateVersionPatch = SQLiteUpdateSetSource<typeof projectTemplateVersions>
type TemplateModulePatch = SQLiteUpdateSetSource<typeof projectTemplateModules>
type EstimateDefaultsPatch = SQLiteUpdateSetSource<typeof estimateTemplateDefaults>
type EstimateLineInsert = typeof estimateTemplateLines.$inferInsert
type EstimateLinePatch = SQLiteUpdateSetSource<typeof estimateTemplateLines>

export function updateTemplatesStatement(db: Db, where: SQL | undefined, patch: TemplatePatch): Statement {
  return db.update(projectTemplates).set(patch).where(where)
}

export async function updateTemplates(db: Db, where: SQL | undefined, patch: TemplatePatch): Promise<D1Result> {
  return db.update(projectTemplates).set(patch).where(where).run()
}

export async function deleteTemplates(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectTemplates).where(where).run()
}

export function updateTemplateVersionsStatement(db: Db, where: SQL | undefined, patch: TemplateVersionPatch): Statement {
  return db.update(projectTemplateVersions).set(patch).where(where)
}

export function updateTemplateModulesStatement(db: Db, where: SQL | undefined, patch: TemplateModulePatch): Statement {
  return db.update(projectTemplateModules).set(patch).where(where)
}

export async function updateTemplateModules(db: Db, where: SQL | undefined, patch: TemplateModulePatch): Promise<D1Result> {
  return db.update(projectTemplateModules).set(patch).where(where).run()
}

export function updateEstimateTemplateDefaultsStatement(
  db: Db,
  where: SQL | undefined,
  patch: EstimateDefaultsPatch
): Statement {
  return db.update(estimateTemplateDefaults).set(patch).where(where)
}

export async function insertEstimateTemplateLine(db: Db, values: EstimateLineInsert): Promise<D1Result> {
  return db.insert(estimateTemplateLines).values(values).run()
}

export async function updateEstimateTemplateLines(
  db: Db,
  where: SQL | undefined,
  patch: EstimateLinePatch
): Promise<D1Result> {
  return db.update(estimateTemplateLines).set(patch).where(where).run()
}

export async function deleteEstimateTemplateLines(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(estimateTemplateLines).where(where).run()
}

// ---- Estimate templates (raw SQL, one batch each)

/** A new estimate template: template, draft version 1, module and defaults. */
export function estimateTemplateDraftStatements(rawDb: D1Database, input: {
  readonly id: string
  readonly versionId: string
  readonly moduleId: string
  readonly organizationId: string
  readonly name: string
  readonly description: string | null
  readonly createdBy: string
  readonly now: string
}): D1PreparedStatement[] {
  return [
    rawDb.prepare(
      `INSERT INTO project_templates (
          id, organization_id, source_system, source_key, name, description,
          template_kind, trade_category, lifecycle_status,
          review_status, current_version_number, created_by, created_at, updated_at
        ) VALUES (?, ?, 'compass', ?, ?, ?, 'estimate', 'Estimating',
          'draft', 'content_captured', 1, ?, ?, ?)`
    ).bind(
      input.id, input.organizationId, `compass:${input.id}`, input.name, input.description, input.createdBy,
      input.now, input.now
    ),
    rawDb.prepare(
      `INSERT INTO project_template_versions (
          id, template_id, version_number, status, notes, created_by, created_at
        ) VALUES (?, ?, 1, 'draft', 'Created in Compass', ?, ?)`
    ).bind(input.versionId, input.id, input.createdBy, input.now),
    rawDb.prepare(
      `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count, normalization_status
        ) VALUES (?, ?, 'estimate', 0, 'draft')`
    ).bind(input.moduleId, input.versionId),
    rawDb.prepare(
      `INSERT INTO estimate_template_defaults (
          version_id, document_title, default_markup_rate_basis_points
        ) VALUES (?, 'CA22 Construction Estimate', 0)`
    ).bind(input.versionId),
  ]
}

/** A copied estimate template line for a new revision; `id` is new and its `versionId` is ignored. */
type EstimateTemplateRevisionLine = typeof estimateTemplateLines.$inferSelect

/** A new draft revision copying the latest version's defaults and lines. */
export function estimateTemplateRevisionStatements(rawDb: D1Database, input: {
  readonly templateId: string
  readonly versionId: string
  readonly moduleId: string
  readonly versionNumber: number
  readonly notes: string
  readonly createdBy: string
  readonly now: string
  readonly defaults: Pick<
    typeof estimateTemplateDefaults.$inferSelect,
    "documentTitle" | "contractTerms" | "defaultMarkupRateBasisPoints"
  >
  readonly lines: readonly EstimateTemplateRevisionLine[]
}): D1PreparedStatement[] {
  const { versionId } = input
  const statements: D1PreparedStatement[] = [
    rawDb.prepare(
      `INSERT INTO project_template_versions (
          id, template_id, version_number, status, notes, created_by, created_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`
    ).bind(versionId, input.templateId, input.versionNumber, input.notes, input.createdBy, input.now),
    rawDb.prepare(
      `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count, normalization_status
        ) VALUES (?, ?, 'estimate', ?, 'draft')`
    ).bind(input.moduleId, versionId, input.lines.length),
    rawDb.prepare(
      `INSERT INTO estimate_template_defaults (
          version_id, document_title, contract_terms,
          default_markup_rate_basis_points
        ) VALUES (?, ?, ?, ?)`
    ).bind(
      versionId, input.defaults.documentTitle, input.defaults.contractTerms,
      input.defaults.defaultMarkupRateBasisPoints
    ),
  ]
  for (const line of input.lines) {
    statements.push(
      rawDb.prepare(
        `INSERT INTO estimate_template_lines (
            id, version_id, item_key, division_code, division_name, cost_code,
            cost_code_name, description, specifications, quantity, unit,
            unit_cost_cents, markup_rate_basis_points, taxable, tax_code,
            owner_visible, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        line.id, versionId, line.itemKey, line.divisionCode, line.divisionName, line.costCode,
        line.costCodeName, line.description, line.specifications, line.quantity, line.unit, line.unitCostCents,
        line.markupRateBasisPoints, line.taxable ? 1 : 0, line.taxCode, line.ownerVisible ? 1 : 0,
        line.sortOrder
      )
    )
  }
  return statements
}

// ---- Template applications

type ApplicationBase = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly templateId: string
  readonly versionId: string
  readonly anchorDate: string
  readonly appliedBy: string
  readonly itemCount: number
  readonly optionsJson: string
  readonly now: string
}

/** An estimate-template application, 'applying' until the batch completes it. */
export function insertEstimateTemplateApplicationStatement(rawDb: D1Database, row: ApplicationBase): D1PreparedStatement {
  return rawDb.prepare(
    `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applying', ?, ?, 0, ?, ?)`
  ).bind(
    row.id, row.organizationId, row.projectId, row.templateId, row.versionId, row.anchorDate, row.appliedBy,
    row.itemCount, row.optionsJson, row.now
  )
}

/** A whole project-template application, 'applying' until the batch completes it. */
export function insertProjectTemplateApplicationStatement(
  rawDb: D1Database,
  row: ApplicationBase & { readonly dependencyCount: number }
): D1PreparedStatement {
  return rawDb.prepare(
    `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applying', ?, ?, ?, ?, ?)`
  ).bind(
    row.id, row.organizationId, row.projectId, row.templateId, row.versionId, row.anchorDate, row.appliedBy,
    row.itemCount, row.dependencyCount, row.optionsJson, row.now
  )
}

/** Selected schedule items imported from a template, recorded as applied at once. */
export function insertAppliedScheduleItemsApplicationStatement(
  rawDb: D1Database,
  row: ApplicationBase & { readonly dependencyCount: number }
): D1PreparedStatement {
  return rawDb.prepare(
    `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id, row.organizationId, row.projectId, row.templateId, row.versionId, row.anchorDate, row.appliedBy,
    row.itemCount, row.dependencyCount, row.optionsJson, row.now, row.now
  )
}

/** Links one created schedule task to the template item it came from. */
export function insertTemplateApplicationItemStatement(rawDb: D1Database, row: {
  readonly id: string
  readonly applicationId: string
  readonly templateItemId: string
  readonly scheduleTaskId: string
}): D1PreparedStatement {
  return rawDb.prepare(
    `INSERT INTO project_template_application_items (
            id, application_id, template_item_id, schedule_task_id
          ) VALUES (?, ?, ?, ?)`
  ).bind(row.id, row.applicationId, row.templateItemId, row.scheduleTaskId)
}

/** The last statement of an application batch: marks it applied. */
export function completeTemplateApplicationStatement(
  rawDb: D1Database,
  applicationId: string,
  now: string
): D1PreparedStatement {
  return rawDb.prepare(
    `UPDATE project_template_applications
         SET status = 'applied', completed_at = ?
         WHERE id = ?`
  ).bind(now, applicationId)
}

// ---- Captured project templates

/** Publishes a reviewed captured draft; both guards keep a replay harmless. */
export function publishCapturedTemplateStatements(rawDb: D1Database, input: {
  readonly templateId: string
  readonly versionId: string
  readonly organizationId: string
  readonly now: string
}): D1PreparedStatement[] {
  return [
    rawDb.prepare(
      `UPDATE project_template_versions SET status='published', notes=? ` +
        `WHERE id=? AND status='draft'`
    ).bind(
      "Captured content reviewed in Compass and published by internal staff.", input.versionId
    ),
    rawDb.prepare(
      `UPDATE project_templates SET lifecycle_status='active', ` +
        `review_status='verified', updated_at=? ` +
        `WHERE id=? AND organization_id=? AND review_status='content_captured'`
    ).bind(input.now, input.templateId, input.organizationId),
  ]
}

// ---- Saved schedule templates

// D1 binds at most 100 parameters per statement.
const ITEM_COLUMNS = 15
const DEPENDENCY_COLUMNS = 6
const MAX_BOUND_PARAMETERS = 100

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

/** The template row of a saved schedule: a new version of an existing one, or a new template. */
export type SavedScheduleTemplateHeader =
  | {
      readonly kind: "existing"
      readonly templateId: string
      readonly organizationId: string
      readonly versionNumber: number
      readonly name: string | null
      readonly tradeCategory: string | null
      readonly description: string | null
      readonly now: string
    }
  | {
      readonly kind: "new"
      readonly templateId: string
      readonly organizationId: string
      readonly versionNumber: number
      readonly name: string
      readonly description: string | null
      readonly templateKind: string
      readonly tradeCategory: string
      readonly sourceMetadataJson: string
      readonly now: string
    }

/**
 * Saves a schedule as a published template version: the template row, the
 * version, the schedule module, and the items and dependencies in
 * multi-row inserts sized to D1's parameter limit.
 */
export function savedScheduleTemplateStatements(rawDb: D1Database, input: {
  readonly header: SavedScheduleTemplateHeader
  readonly versionId: string
  readonly moduleId: string
  readonly createdBy: string
  readonly versionNotes: string
  readonly modulePayloadJson: string
  readonly items: readonly CapturedScheduleTemplateItem[]
  readonly dependencies: readonly CapturedScheduleTemplateDependency[]
}): D1PreparedStatement[] {
  const { header, versionId } = input
  const statements: D1PreparedStatement[] = [
    savedScheduleTemplateHeaderStatement(rawDb, header, input.createdBy),
  ]
  statements.push(
    rawDb.prepare(
      `INSERT INTO project_template_versions (
          id, template_id, version_number, status, source_fingerprint,
          source_captured_at, notes, created_by, created_at
        ) VALUES (?, ?, ?, 'published', NULL, ?, ?, ?, ?)`
    ).bind(
      versionId, header.templateId, header.versionNumber, header.now, input.versionNotes, input.createdBy,
      header.now
    ),
    rawDb.prepare(
      `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count,
          normalization_status, source_payload_json
        ) VALUES (?, ?, 'schedule', ?, 'captured', ?)`
    ).bind(input.moduleId, versionId, input.items.length, input.modulePayloadJson)
  )
  statements.push(...scheduleTemplateItemStatements(rawDb, versionId, input.items))
  statements.push(...scheduleTemplateDependencyStatements(rawDb, versionId, input.dependencies))
  return statements
}

function savedScheduleTemplateHeaderStatement(
  rawDb: D1Database,
  header: SavedScheduleTemplateHeader,
  createdBy: string
): D1PreparedStatement {
  if (header.kind === "existing") {
    return rawDb.prepare(
      `UPDATE project_templates SET current_version_number = ?,
            name = ?, trade_category = ?, description = ?,
            lifecycle_status = 'active', review_status = 'verified',
            updated_at = ?
          WHERE id = ? AND organization_id = ?`
    ).bind(
      header.versionNumber, header.name, header.tradeCategory, header.description, header.now,
      header.templateId, header.organizationId
    )
  }
  return rawDb.prepare(
    `INSERT INTO project_templates (
            id, organization_id, source_system, source_key, source_template_id,
            source_url, name, description, template_kind, department_code,
            trade_category, lifecycle_status, review_status,
            current_version_number, source_metadata_json, created_by,
            created_at, updated_at
          ) VALUES (?, ?, 'compass', ?, NULL, NULL, ?, ?, ?, NULL, ?,
            'active', 'verified', ?, ?, ?, ?, ?)`
  ).bind(
    header.templateId, header.organizationId, `schedule:${header.templateId}`, header.name, header.description,
    header.templateKind, header.tradeCategory, header.versionNumber, header.sourceMetadataJson, createdBy,
    header.now, header.now
  )
}

function scheduleTemplateItemStatements(
  rawDb: D1Database,
  versionId: string,
  items: readonly CapturedScheduleTemplateItem[]
): readonly D1PreparedStatement[] {
  return chunk(items, Math.floor(MAX_BOUND_PARAMETERS / ITEM_COLUMNS)).map((rows) =>
    rawDb
      .prepare(
        `INSERT INTO schedule_template_items (
          id, version_id, source_item_id, item_key, title,
          start_offset_workdays, workdays, phase, display_color, is_milestone,
          assignee_placeholder, owner_visible, sub_vendor_visible, notes,
          sort_order
        ) VALUES ${rows.map(() => `(${Array(ITEM_COLUMNS).fill("?").join(", ")})`).join(", ")}`
      )
      .bind(
        ...rows.flatMap((item) => [
          item.id,
          versionId,
          item.sourceItemId,
          item.itemKey,
          item.title,
          item.startOffsetWorkdays,
          item.workdays,
          item.phase,
          item.displayColor,
          item.isMilestone ? 1 : 0,
          item.assigneePlaceholder,
          item.ownerVisible ? 1 : 0,
          item.subVendorVisible ? 1 : 0,
          item.notes,
          item.sortOrder,
        ])
      )
  )
}

function scheduleTemplateDependencyStatements(
  rawDb: D1Database,
  versionId: string,
  dependencies: readonly CapturedScheduleTemplateDependency[]
): readonly D1PreparedStatement[] {
  return chunk(dependencies, Math.floor(MAX_BOUND_PARAMETERS / DEPENDENCY_COLUMNS)).map((rows) =>
    rawDb
      .prepare(
        `INSERT INTO schedule_template_dependencies (
          id, version_id, predecessor_item_id, successor_item_id, type, lag_days
        ) VALUES ${rows.map(() => `(${Array(DEPENDENCY_COLUMNS).fill("?").join(", ")})`).join(", ")}`
      )
      .bind(
        ...rows.flatMap((dependency) => [
          dependency.id,
          versionId,
          dependency.predecessorItemId,
          dependency.successorItemId,
          dependency.type,
          dependency.lagDays,
        ])
      )
  )
}

// ---- Buildertrend template SQL files (applied with Wrangler)

/** An active Buildertrend template from the inventory, without content yet. */
export function buildertrendInventoryTemplateUpsertSql(row: {
  readonly id: string
  readonly organizationId: string
  readonly sourceKey: string
  readonly sourceTemplateId: string | null
  readonly name: string
  readonly templateKind: string
  readonly tradeCategory: string | null
  readonly sourceMetadataJson: string
  readonly capturedAt: string
}): string {
  return (
    `INSERT INTO project_templates (` +
    `id, organization_id, source_system, source_key, source_template_id, ` +
    `source_url, name, template_kind, department_code, trade_category, ` +
    `lifecycle_status, review_status, source_metadata_json, created_at, updated_at` +
    `) VALUES (` +
    [
      sql(row.id),
      sql(row.organizationId),
      sql("buildertrend"),
      sql(row.sourceKey),
      sql(row.sourceTemplateId),
      sql(null),
      sql(row.name),
      sql(row.templateKind),
      // Department/branding is selected by the destination project, not the template.
      sql(null),
      sql(row.tradeCategory),
      sql("draft"),
      sql("inventory_only"),
      sql(row.sourceMetadataJson),
      sql(row.capturedAt),
      sql(row.capturedAt),
    ].join(", ") +
    `) ON CONFLICT(organization_id, source_system, source_key) DO UPDATE SET ` +
    `source_template_id=excluded.source_template_id, ` +
    `source_url=NULL, name=excluded.name, ` +
    `template_kind=excluded.template_kind, ` +
    `department_code=project_templates.department_code, ` +
    `trade_category=excluded.trade_category, ` +
    `source_metadata_json=excluded.source_metadata_json, ` +
    `updated_at=excluded.updated_at;`
  )
}

/** A captured Buildertrend template; a verified review status is kept. */
export function buildertrendCapturedTemplateUpsertSql(row: {
  readonly id: string
  readonly organizationId: string
  readonly sourceKey: string
  readonly sourceTemplateId: string | null
  readonly name: string
  readonly templateKind: string
  readonly departmentCode: string | null
  readonly tradeCategory: string | null
  readonly reviewStatus: string
  readonly sourceMetadataJson: string
  readonly capturedAt: string
}): string {
  return (
    `INSERT INTO project_templates (` +
    `id, organization_id, source_system, source_key, source_template_id, ` +
    `source_url, name, template_kind, department_code, trade_category, ` +
    `lifecycle_status, review_status, current_version_number, ` +
    `source_metadata_json, created_at, updated_at` +
    `) VALUES (` +
    [
      sql(row.id),
      sql(row.organizationId),
      sql("buildertrend"),
      sql(row.sourceKey),
      sql(row.sourceTemplateId),
      sql(null),
      sql(row.name),
      sql(row.templateKind),
      sql(row.departmentCode),
      sql(row.tradeCategory),
      sql("draft"),
      sql(row.reviewStatus),
      1,
      sql(row.sourceMetadataJson),
      sql(row.capturedAt),
      sql(row.capturedAt),
    ].join(", ") +
    `) ON CONFLICT(organization_id, source_system, source_key) DO UPDATE SET ` +
    `source_template_id=excluded.source_template_id, ` +
    `source_url=NULL, name=excluded.name, ` +
    `template_kind=excluded.template_kind, ` +
    `department_code=project_templates.department_code, ` +
    `trade_category=excluded.trade_category, ` +
    `review_status=CASE WHEN project_templates.review_status='verified' ` +
    `THEN project_templates.review_status ELSE excluded.review_status END, ` +
    `current_version_number=COALESCE(` +
    `project_templates.current_version_number, excluded.current_version_number), ` +
    `source_metadata_json=excluded.source_metadata_json, ` +
    `updated_at=excluded.updated_at;`
  )
}

/** Version 1 of a captured template; only a draft is refreshed. */
export function buildertrendCapturedVersionUpsertSql(row: {
  readonly id: string
  readonly templateId: string
  readonly fingerprint: string
  readonly capturedAt: string
}): string {
  return (
    `INSERT INTO project_template_versions (` +
    `id, template_id, version_number, status, source_fingerprint, ` +
    `source_captured_at, notes, created_at` +
    `) VALUES (` +
    [
      sql(row.id),
      sql(row.templateId),
      1,
      sql("draft"),
      sql(row.fingerprint),
      sql(row.capturedAt),
      sql("Captured from Buildertrend; review required before publishing."),
      sql(row.capturedAt),
    ].join(", ") +
    `) ON CONFLICT(template_id, version_number) DO UPDATE SET ` +
    `source_fingerprint=excluded.source_fingerprint, ` +
    `source_captured_at=excluded.source_captured_at, ` +
    `notes=excluded.notes WHERE project_template_versions.status='draft';`
  )
}

/** Writes below run only while the captured version is still a draft. */
function draftVersionGuard(versionId: string): string {
  return (
    `EXISTS (SELECT 1 FROM project_template_versions ` +
    `WHERE id=${sql(versionId)} AND status='draft')`
  )
}

export function buildertrendCapturedModuleUpsertSql(row: {
  readonly id: string
  readonly versionId: string
  readonly moduleType: string
  readonly sourceItemCount: number
  readonly normalizationStatus: string
  readonly payloadJson: string
}): string {
  const guard = draftVersionGuard(row.versionId)
  return (
    `INSERT INTO project_template_modules (` +
    `id, version_id, module_type, source_item_count, ` +
    `normalization_status, source_payload_json` +
    `) SELECT ` +
    [
      sql(row.id),
      sql(row.versionId),
      sql(row.moduleType),
      row.sourceItemCount,
      sql(row.normalizationStatus),
      sql(row.payloadJson),
    ].join(", ") +
    ` WHERE ${guard} ` +
    `ON CONFLICT(version_id, module_type) DO UPDATE SET ` +
    `source_item_count=excluded.source_item_count, ` +
    `normalization_status=excluded.normalization_status, ` +
    `source_payload_json=excluded.source_payload_json ` +
    `WHERE ${guard};`
  )
}

export function buildertrendCapturedScheduleItemUpsertSql(row: {
  readonly id: string
  readonly versionId: string
  readonly sourceItemId: string
  readonly title: string
  readonly startOffsetWorkdays: number
  readonly workdays: number
  readonly phase: string | null
  readonly displayColor: string | null
  readonly isMilestone: boolean
  readonly assigneePlaceholder: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly notes: string | null
  readonly sortOrder: number
}): string {
  const guard = draftVersionGuard(row.versionId)
  return (
    `INSERT INTO schedule_template_items (` +
    `id, version_id, source_item_id, item_key, title, ` +
    `start_offset_workdays, workdays, phase, display_color, ` +
    `is_milestone, assignee_placeholder, owner_visible, ` +
    `sub_vendor_visible, notes, sort_order` +
    `) SELECT ` +
    [
      sql(row.id),
      sql(row.versionId),
      sql(row.sourceItemId),
      sql(`buildertrend:${row.sourceItemId}`),
      sql(row.title),
      row.startOffsetWorkdays,
      row.workdays,
      sql(row.phase),
      sql(row.displayColor),
      row.isMilestone ? 1 : 0,
      sql(row.assigneePlaceholder),
      row.ownerVisible ? 1 : 0,
      row.subVendorVisible ? 1 : 0,
      sql(row.notes),
      row.sortOrder,
    ].join(", ") +
    ` WHERE ${guard} ` +
    `ON CONFLICT(version_id, item_key) DO UPDATE SET ` +
    `title=excluded.title, ` +
    `start_offset_workdays=excluded.start_offset_workdays, ` +
    `workdays=excluded.workdays, phase=excluded.phase, ` +
    `display_color=excluded.display_color, ` +
    `is_milestone=excluded.is_milestone, ` +
    `assignee_placeholder=excluded.assignee_placeholder, ` +
    `owner_visible=excluded.owner_visible, ` +
    `sub_vendor_visible=excluded.sub_vendor_visible, ` +
    `notes=excluded.notes, ` +
    `sort_order=excluded.sort_order WHERE ${guard};`
  )
}

export function buildertrendCapturedDependencyUpsertSql(row: {
  readonly id: string
  readonly versionId: string
  readonly predecessorItemId: string
  readonly successorItemId: string
  readonly type: string
  readonly lagDays: number
}): string {
  const guard = draftVersionGuard(row.versionId)
  return (
    `INSERT INTO schedule_template_dependencies (` +
    `id, version_id, predecessor_item_id, successor_item_id, type, lag_days` +
    `) SELECT ` +
    [
      sql(row.id),
      sql(row.versionId),
      sql(row.predecessorItemId),
      sql(row.successorItemId),
      sql(row.type),
      row.lagDays,
    ].join(", ") +
    ` WHERE ${guard} ` +
    `ON CONFLICT(version_id, predecessor_item_id, successor_item_id, type) ` +
    `DO UPDATE SET lag_days=excluded.lag_days WHERE ${guard};`
  )
}

/**
 * Publishes a captured schedule only when the stored item and dependency
 * counts match the capture, then activates the template.
 */
export function buildertrendCapturedPublishSql(row: {
  readonly templateId: string
  readonly versionId: string
  readonly expectedItemCount: number
  readonly expectedDependencyCount: number
  readonly capturedAt: string
}): readonly string[] {
  const versionId = sql(row.versionId)
  return [
    `UPDATE project_template_versions SET ` +
      `status='published', ` +
      `notes=${sql("Captured and count-verified from active Buildertrend template.")} ` +
      `WHERE id=${versionId} AND status='draft' ` +
      `AND (SELECT COUNT(*) FROM schedule_template_items ` +
      `WHERE version_id=${versionId})=${row.expectedItemCount} ` +
      `AND (SELECT COUNT(*) FROM schedule_template_dependencies ` +
      `WHERE version_id=${versionId})=${row.expectedDependencyCount};`,
    `UPDATE project_templates SET lifecycle_status='active', ` +
      `review_status='verified', updated_at=${sql(row.capturedAt)} ` +
      `WHERE id=${sql(row.templateId)} AND source_system='buildertrend' ` +
      `AND EXISTS (SELECT 1 FROM project_template_versions ` +
      `WHERE id=${versionId} AND status='published');`,
  ]
}
