import { and, eq, ne, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
} from "@/db/schema"
import {
  projectEstimateAcknowledgements,
  projectEstimateAssemblies,
  projectEstimateAssemblyCopies,
  projectEstimateBasisDocuments,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimateReportPhases,
  projectEstimates,
  projectPhaseProposals,
} from "@/db/schema-estimates"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import type { EstimateAssembly } from "@/lib/estimates/assemblies"
import type { Db } from "@/lib/server/action-context"

/*
 * The estimates domain store: the only code that inserts, updates or deletes
 * estimates, their lines, cost items, assemblies, report phases, phase
 * proposals, and change orders (architecture standard, section 1).
 *
 * Each table has the same small set of writers. `*Statement` builds an
 * unexecuted statement for `db.batch`; the plain form runs one statement.
 * Callers pass the same `where` conditions they used before, so the SQL is
 * unchanged. The store has no access rules; callers check access first.
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

// ---- projectEstimates

type EstimateInsert = typeof projectEstimates.$inferInsert
type EstimatePatch = SQLiteUpdateSetSource<typeof projectEstimates>

export function insertEstimateStatement(db: Db, values: EstimateInsert | readonly EstimateInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimates).values([...values]) : db.insert(projectEstimates).values(values)
}

export async function insertEstimate(db: Db, values: EstimateInsert | readonly EstimateInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimates).values([...values]).run() : db.insert(projectEstimates).values(values).run()
}

export function updateEstimatesStatement(db: Db, where: SQL | undefined, patch: EstimatePatch): Statement {
  return db.update(projectEstimates).set(patch).where(where)
}

export async function updateEstimates(db: Db, where: SQL | undefined, patch: EstimatePatch): Promise<D1Result> {
  return db.update(projectEstimates).set(patch).where(where).run()
}

export function deleteEstimatesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimates).where(where)
}

export async function deleteEstimates(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimates).where(where).run()
}

// ---- projectEstimateLines

type EstimateLineInsert = typeof projectEstimateLines.$inferInsert
type EstimateLinePatch = SQLiteUpdateSetSource<typeof projectEstimateLines>

export function insertEstimateLineStatement(db: Db, values: EstimateLineInsert | readonly EstimateLineInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateLines).values([...values]) : db.insert(projectEstimateLines).values(values)
}

export async function insertEstimateLine(db: Db, values: EstimateLineInsert | readonly EstimateLineInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateLines).values([...values]).run() : db.insert(projectEstimateLines).values(values).run()
}

export function updateEstimateLinesStatement(db: Db, where: SQL | undefined, patch: EstimateLinePatch): Statement {
  return db.update(projectEstimateLines).set(patch).where(where)
}

export async function updateEstimateLines(db: Db, where: SQL | undefined, patch: EstimateLinePatch): Promise<D1Result> {
  return db.update(projectEstimateLines).set(patch).where(where).run()
}

export function deleteEstimateLinesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateLines).where(where)
}

export async function deleteEstimateLines(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateLines).where(where).run()
}

// ---- projectEstimateAssemblies

type EstimateAssemblyInsert = typeof projectEstimateAssemblies.$inferInsert
type EstimateAssemblyPatch = SQLiteUpdateSetSource<typeof projectEstimateAssemblies>

export function insertEstimateAssemblyStatement(db: Db, values: EstimateAssemblyInsert | readonly EstimateAssemblyInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateAssemblies).values([...values]) : db.insert(projectEstimateAssemblies).values(values)
}

export function updateEstimateAssembliesStatement(db: Db, where: SQL | undefined, patch: EstimateAssemblyPatch): Statement {
  return db.update(projectEstimateAssemblies).set(patch).where(where)
}

export function deleteEstimateAssembliesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateAssemblies).where(where)
}

// ---- projectEstimateAssemblyCopies

type EstimateAssemblyCopyInsert = typeof projectEstimateAssemblyCopies.$inferInsert

export function insertEstimateAssemblyCopyStatement(db: Db, values: EstimateAssemblyCopyInsert | readonly EstimateAssemblyCopyInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateAssemblyCopies).values([...values]) : db.insert(projectEstimateAssemblyCopies).values(values)
}

// ---- projectEstimateLineCostItems

type EstimateLineCostItemInsert = typeof projectEstimateLineCostItems.$inferInsert
type EstimateLineCostItemPatch = SQLiteUpdateSetSource<typeof projectEstimateLineCostItems>

export function insertEstimateLineCostItemStatement(db: Db, values: EstimateLineCostItemInsert | readonly EstimateLineCostItemInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateLineCostItems).values([...values]) : db.insert(projectEstimateLineCostItems).values(values)
}

export async function insertEstimateLineCostItem(db: Db, values: EstimateLineCostItemInsert | readonly EstimateLineCostItemInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateLineCostItems).values([...values]).run() : db.insert(projectEstimateLineCostItems).values(values).run()
}

export async function updateEstimateLineCostItems(db: Db, where: SQL | undefined, patch: EstimateLineCostItemPatch): Promise<D1Result> {
  return db.update(projectEstimateLineCostItems).set(patch).where(where).run()
}

// ---- projectEstimateReportPhases

type EstimateReportPhaseInsert = typeof projectEstimateReportPhases.$inferInsert
type EstimateReportPhasePatch = SQLiteUpdateSetSource<typeof projectEstimateReportPhases>

export function insertEstimateReportPhaseStatement(db: Db, values: EstimateReportPhaseInsert | readonly EstimateReportPhaseInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateReportPhases).values([...values]) : db.insert(projectEstimateReportPhases).values(values)
}

export function updateEstimateReportPhasesStatement(db: Db, where: SQL | undefined, patch: EstimateReportPhasePatch): Statement {
  return db.update(projectEstimateReportPhases).set(patch).where(where)
}

export function deleteEstimateReportPhasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateReportPhases).where(where)
}

// ---- projectEstimatePhaseDescriptions

type EstimatePhaseDescriptionInsert = typeof projectEstimatePhaseDescriptions.$inferInsert

export async function deleteEstimatePhaseDescriptions(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimatePhaseDescriptions).where(where).run()
}

// ---- projectEstimateAcknowledgements

type EstimateAcknowledgementInsert = typeof projectEstimateAcknowledgements.$inferInsert

export async function insertEstimateAcknowledgement(db: Db, values: EstimateAcknowledgementInsert | readonly EstimateAcknowledgementInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateAcknowledgements).values([...values]).run() : db.insert(projectEstimateAcknowledgements).values(values).run()
}

export async function deleteEstimateAcknowledgements(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateAcknowledgements).where(where).run()
}

// ---- projectEstimateBasisDocuments

type EstimateBasisDocumentInsert = typeof projectEstimateBasisDocuments.$inferInsert

export async function insertEstimateBasisDocument(db: Db, values: EstimateBasisDocumentInsert | readonly EstimateBasisDocumentInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateBasisDocuments).values([...values]).run() : db.insert(projectEstimateBasisDocuments).values(values).run()
}

export async function deleteEstimateBasisDocuments(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateBasisDocuments).where(where).run()
}

// ---- projectPhaseProposals

type PhaseProposalInsert = typeof projectPhaseProposals.$inferInsert
type PhaseProposalPatch = SQLiteUpdateSetSource<typeof projectPhaseProposals>

export function updatePhaseProposalsStatement(db: Db, where: SQL | undefined, patch: PhaseProposalPatch): Statement {
  return db.update(projectPhaseProposals).set(patch).where(where)
}

export function deletePhaseProposalsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectPhaseProposals).where(where)
}

// ---- projectChangeOrders

type ChangeOrderInsert = typeof projectChangeOrders.$inferInsert
type ChangeOrderPatch = SQLiteUpdateSetSource<typeof projectChangeOrders>

export function insertChangeOrderStatement(db: Db, values: ChangeOrderInsert | readonly ChangeOrderInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrders).values([...values]) : db.insert(projectChangeOrders).values(values)
}

export function updateChangeOrdersStatement(db: Db, where: SQL | undefined, patch: ChangeOrderPatch): Statement {
  return db.update(projectChangeOrders).set(patch).where(where)
}

// ---- projectChangeOrderLines

type ChangeOrderLineInsert = typeof projectChangeOrderLines.$inferInsert

export function insertChangeOrderLineStatement(db: Db, values: ChangeOrderLineInsert | readonly ChangeOrderLineInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderLines).values([...values]) : db.insert(projectChangeOrderLines).values(values)
}

export function deleteChangeOrderLinesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrderLines).where(where)
}

// ---- projectChangeOrderDocuments

type ChangeOrderDocumentInsert = typeof projectChangeOrderDocuments.$inferInsert

export function insertChangeOrderDocumentStatement(db: Db, values: ChangeOrderDocumentInsert | readonly ChangeOrderDocumentInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderDocuments).values([...values]) : db.insert(projectChangeOrderDocuments).values(values)
}

export function deleteChangeOrderDocumentsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrderDocuments).where(where)
}

// ---- projectChangeOrderHistory

type ChangeOrderHistoryInsert = typeof projectChangeOrderHistory.$inferInsert

export function insertChangeOrderHistoryStatement(db: Db, values: ChangeOrderHistoryInsert | readonly ChangeOrderHistoryInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderHistory).values([...values]) : db.insert(projectChangeOrderHistory).values(values)
}

function isRows<T>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ==== Named operations: estimates (workspace, drafts, imports, lines, acceptance)

/** Saves a phase's description, replacing the one already on the estimate. */
export async function upsertEstimatePhaseDescription(
  db: Db,
  values: EstimatePhaseDescriptionInsert & { readonly description: string; readonly updatedAt: string }
): Promise<D1Result> {
  return db
    .insert(projectEstimatePhaseDescriptions)
    .values(values)
    .onConflictDoUpdate({
      target: [projectEstimatePhaseDescriptions.estimateId, projectEstimatePhaseDescriptions.divisionCode],
      set: { description: values.description, updatedAt: values.updatedAt },
    })
    .run()
}

/** One line's or cost item's stored amounts at a new markup rate. */
type MarkupRepricing = {
  readonly id: string
  readonly markupRateBasisPoints: number
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly lineTotalCents: number
}

/** Fixed-size statements that reprice lines and cost items at one markup rate. */
export function lineMarkupStatements(input: {
  readonly rawDb: D1Database
  readonly projectId: string
  readonly estimateId: string
  readonly now: string
  readonly lines: readonly MarkupRepricing[]
  readonly costItems: readonly MarkupRepricing[]
}): D1PreparedStatement[] {
  const { rawDb, projectId, estimateId, now } = input
  return [
    ...input.lines.map((line) =>
      rawDb
        .prepare(
          `UPDATE project_estimate_lines
             SET markup_rate_basis_points = ?, direct_cost_cents = ?,
               markup_cents = ?, tax_cents = ?, line_total_cents = ?,
               updated_at = ?
             WHERE id = ? AND estimate_id = ? AND project_id = ?`
        )
        .bind(line.markupRateBasisPoints, line.directCostCents, line.markupCents, line.taxCents, line.lineTotalCents, now, line.id, estimateId, projectId)
    ),
    ...input.costItems.map((item) =>
      rawDb
        .prepare(
          `UPDATE project_estimate_line_cost_items
             SET markup_rate_basis_points = ?, direct_cost_cents = ?,
               markup_cents = ?, tax_cents = ?, line_total_cents = ?,
               total_cost_cents = ?, updated_at = ?
             WHERE id = ? AND estimate_id = ? AND project_id = ?
               AND deleted_at IS NULL`
        )
        .bind(item.markupRateBasisPoints, item.directCostCents, item.markupCents, item.taxCents, item.lineTotalCents, item.lineTotalCents, now, item.id, estimateId, projectId)
    ),
  ]
}

/**
 * Copies assemblies to a revision. The caller copies all lines first,
 * including their existing assembly ids; fixed-size statements remap them.
 */
export function estimateAssemblyRevisionStatements(input: {
  readonly db: D1Database
  readonly projectId: string
  readonly estimateId: string
  readonly now: string
  // A change-order estimate's assemblies keep the contract assembly they change.
  readonly assemblies: readonly (EstimateAssembly & { readonly contractAssemblyId?: string | null })[]
}): readonly D1PreparedStatement[] {
  const copies = input.assemblies.map((assembly) => ({ assembly, id: crypto.randomUUID() }))
  return [
    ...copies.map(({ assembly, id }) => input.db.prepare(
      `INSERT INTO project_estimate_assemblies
       (id, estimate_id, name, description, sort_order, client_detail, contract_assembly_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.estimateId, assembly.name, assembly.description, assembly.sortOrder, assembly.clientDetail ? 1 : 0, assembly.contractAssemblyId ?? null, input.now, input.now)),
    ...copies.map(({ assembly, id }) => input.db.prepare(
      `UPDATE project_estimate_lines SET assembly_id = ?
       WHERE estimate_id = ? AND project_id = ? AND assembly_id = ?`
    ).bind(id, input.estimateId, input.projectId, assembly.id)),
  ]
}

/**
 * Every write that copies an estimate into a new draft version, for one
 * `rawDb.batch`: older open versions are superseded, then the header, report
 * phases, lines, assemblies, cost items, basis documents, phase descriptions
 * and acknowledgements are copied. Moving to another phase drops links that
 * belong to the source project.
 */
export function estimateCopyStatements(input: {
  readonly db: Db
  readonly rawDb: D1Database
  readonly header: EstimateInsert
  readonly sourceProjectId: string
  readonly sourceEstimateId: string
  readonly destinationProjectId: string
  readonly estimateNumber: string
  readonly now: string
  readonly phases: readonly (typeof projectEstimateReportPhases.$inferSelect)[]
  readonly assemblies: readonly EstimateAssembly[]
}): D1PreparedStatement[] {
  const { rawDb, now, sourceEstimateId, destinationProjectId } = input
  const projectId = input.sourceProjectId
  const id = input.header.id
  const changingPhase = destinationProjectId !== projectId
  const header = input.db.insert(projectEstimates).values(input.header).toSQL()
  const phaseCopies = input.phases.map((phase) => ({ phase, id: crypto.randomUUID() }))
  return [
    rawDb
      .prepare(
        `UPDATE project_estimates
           SET status = 'superseded', updated_at = ?
           WHERE project_id = ? AND estimate_number = ?
             AND status IN ('draft', 'internal_review', 'signature_pending')`
      )
      .bind(now, destinationProjectId, input.estimateNumber),
    rawDb.prepare(header.sql).bind(...header.params),
    ...phaseCopies.map((copy) => rawDb.prepare(
      `INSERT INTO project_estimate_report_phases
         (id, project_id, estimate_id, division_code, name, description, itemize, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(copy.id, destinationProjectId, id, copy.phase.divisionCode, copy.phase.name, copy.phase.description, copy.phase.itemize ? 1 : 0, copy.phase.sortOrder, now, now)),
    rawDb
      .prepare(
        `INSERT INTO project_estimate_lines (
             id, project_id, estimate_id, template_line_id, report_phase_id, assembly_id, division_code,
             division_name, cost_code, cost_code_name, description,
             specifications, quantity, unit, unit_cost_cents, direct_cost_cents,
             markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
             tax_code, tax_name, tax_rate_basis_points, tax_cents,
             line_total_cents, owner_visible, include_in_builder_fee,
             pricing_source, pricing_todo_id,
             sort_order, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), ?, ?, ${changingPhase ? "NULL" : "template_line_id"},
             report_phase_id, assembly_id,
             division_code, division_name, cost_code, cost_code_name,
             description, specifications, quantity, unit, unit_cost_cents,
             direct_cost_cents, markup_rate_basis_points, markup_cents, taxable,
             tax_entity_id, tax_code, tax_name, tax_rate_basis_points, tax_cents,
             line_total_cents, owner_visible, include_in_builder_fee,
             pricing_source, ${destinationProjectId === projectId ? "pricing_todo_id" : "NULL"},
             sort_order, ?, ?
           FROM project_estimate_lines
           WHERE estimate_id = ? AND project_id = ?`
      )
      .bind(destinationProjectId, id, now, now, sourceEstimateId, projectId),
    // Remap atomically with fixed-size statements; phase count does not
    // consume D1's per-statement parameter budget.
    ...phaseCopies.map((copy) => rawDb.prepare(
      `UPDATE project_estimate_lines SET report_phase_id = ?
         WHERE estimate_id = ? AND project_id = ? AND report_phase_id = ?`
    ).bind(copy.id, id, destinationProjectId, copy.phase.id)),
    ...estimateAssemblyRevisionStatements({ db: rawDb, projectId: destinationProjectId, estimateId: id, now, assemblies: input.assemblies }),
    rawDb
      .prepare(
        `INSERT INTO project_estimate_line_cost_items (
             id, project_id, estimate_id, estimate_line_id, division_code,
             division_name, cost_code, cost_code_name, description, quantity,
             unit, unit_cost_cents, direct_cost_cents,
             markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
             tax_code, tax_name, tax_rate_basis_points, tax_cents,
             line_total_cents, total_cost_cents, sort_order, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), ?, ?,
             copied_line.id, cost_item.division_code, cost_item.division_name,
             cost_item.cost_code, cost_item.cost_code_name,
             cost_item.description, cost_item.quantity, cost_item.unit,
             cost_item.unit_cost_cents, cost_item.direct_cost_cents,
             cost_item.markup_rate_basis_points, cost_item.markup_cents,
             cost_item.taxable, cost_item.tax_entity_id, cost_item.tax_code,
             cost_item.tax_name, cost_item.tax_rate_basis_points,
             cost_item.tax_cents, cost_item.line_total_cents,
             cost_item.total_cost_cents,
             cost_item.sort_order, ?, ?
           FROM project_estimate_line_cost_items AS cost_item
           INNER JOIN project_estimate_lines AS source_line
             ON source_line.id = cost_item.estimate_line_id
           INNER JOIN project_estimate_lines AS copied_line
             ON copied_line.estimate_id = ?
             AND copied_line.sort_order = source_line.sort_order
             AND copied_line.cost_code = source_line.cost_code
             AND copied_line.description = source_line.description
           WHERE cost_item.estimate_id = ? AND cost_item.project_id = ?
             AND cost_item.deleted_at IS NULL`
      )
      .bind(destinationProjectId, id, now, now, id, sourceEstimateId, projectId),
    rawDb
      .prepare(
        `INSERT INTO project_estimate_basis_documents (
             id, project_id, estimate_id, project_document_id,
             document_type, title, document_date,
             revision, drive_file_id, drive_url, notes, sort_order, created_at,
             updated_at
           )
           SELECT lower(hex(randomblob(16))), ?, ?, ${changingPhase ? "NULL" : "project_document_id"},
             document_type, title, document_date, revision,
             ${changingPhase ? "NULL" : "drive_file_id"},
             ${changingPhase ? "NULL" : "drive_url"}, notes, sort_order, ?, ?
           FROM project_estimate_basis_documents
           WHERE estimate_id = ? AND project_id = ?`
      )
      .bind(destinationProjectId, id, now, now, sourceEstimateId, projectId),
    rawDb
      .prepare(
        `INSERT INTO project_estimate_phase_descriptions (
             id, project_id, estimate_id, division_code, description,
             created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), ?, ?, division_code,
             description, ?, ?
           FROM project_estimate_phase_descriptions
           WHERE estimate_id = ? AND project_id = ?`
      )
      .bind(destinationProjectId, id, now, now, sourceEstimateId, projectId),
    rawDb
      .prepare(
        `INSERT INTO project_estimate_acknowledgements (
             id, project_id, estimate_id, template_id, title, body,
             source_document_id, source_url, sort_order, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), ?, ?, template_id, title,
             body, ${changingPhase ? "NULL" : "source_document_id"},
             ${changingPhase ? "NULL" : "source_url"}, sort_order, ?, ?
           FROM project_estimate_acknowledgements
           WHERE estimate_id = ? AND project_id = ?`
      )
      .bind(destinationProjectId, id, now, now, sourceEstimateId, projectId),
  ]
}

// ==== Named operations: change orders and phase proposals

/**
 * Copies one assembly of a contract estimate into a new phase estimate:
 * the proposal, the estimate header, the assembly, its lines and cost items,
 * and the estimate's report phases, phase descriptions, acknowledgements and
 * basis documents, in one D1 batch. Returns each statement's result.
 */
export async function copyAssemblyAsPhaseEstimate(
  db: Db,
  rawDb: D1Database,
  input: {
    readonly proposal: PhaseProposalInsert
    readonly header: EstimateInsert
    /** The new phase estimate's id (the header's id). */
    readonly estimateId: string
    readonly projectId: string
    readonly sourceEstimateId: string
    readonly sourceAssemblyId: string
    readonly newAssemblyId: string
    readonly assembly: { readonly name: string; readonly description: string | null }
    readonly now: string
  }
): Promise<readonly D1Result[]> {
  const proposal = db.insert(projectPhaseProposals).values(input.proposal).toSQL()
  const header = db.insert(projectEstimates).values(input.header).toSQL()
  const { estimateId: id, projectId, sourceEstimateId: estimateId, sourceAssemblyId: assemblyId, newAssemblyId, assembly, now } = input
  return rawDb.batch([
      rawDb.prepare(proposal.sql).bind(...proposal.params),
      rawDb.prepare(header.sql).bind(...header.params),
      rawDb.prepare(
        `INSERT INTO project_estimate_assemblies (id, estimate_id, name, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).bind(newAssemblyId, id, assembly.name, assembly.description, now, now),
      // Report phases keep their ids' meaning through a lookup on the copy.
      rawDb.prepare(
        `INSERT INTO project_estimate_report_phases
         (id, project_id, estimate_id, division_code, name, description, itemize, sort_order, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), project_id, ?, division_code, name, description, itemize, sort_order, ?, ?
         FROM project_estimate_report_phases WHERE estimate_id = ? AND project_id = ?`
      ).bind(id, now, now, estimateId, projectId),
      rawDb.prepare(
        `INSERT INTO project_estimate_lines (
           id, project_id, estimate_id, template_line_id, report_phase_id, assembly_id, division_code,
           division_name, cost_code, cost_code_name, description,
           specifications, quantity, unit, unit_cost_cents, direct_cost_cents,
           markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
           tax_code, tax_name, tax_rate_basis_points, tax_cents,
           line_total_cents, owner_visible, include_in_builder_fee,
           sort_order, created_at, updated_at
         )
         SELECT lower(hex(randomblob(16))), project_id, ?, template_line_id,
           (SELECT copy.id FROM project_estimate_report_phases AS copy
              INNER JOIN project_estimate_report_phases AS original ON original.id = line.report_phase_id
              WHERE copy.estimate_id = ? AND copy.name = original.name
                AND copy.division_code = original.division_code AND copy.sort_order = original.sort_order
              LIMIT 1),
           ?, division_code, division_name, cost_code, cost_code_name,
           description, specifications, quantity, unit, unit_cost_cents,
           direct_cost_cents, markup_rate_basis_points, markup_cents, taxable,
           tax_entity_id, tax_code, tax_name, tax_rate_basis_points, tax_cents,
           line_total_cents, owner_visible, include_in_builder_fee,
           sort_order, ?, ?
         FROM project_estimate_lines AS line
         WHERE estimate_id = ? AND project_id = ? AND assembly_id = ?`
      ).bind(id, id, newAssemblyId, now, now, estimateId, projectId, assemblyId),
      rawDb.prepare(
        `INSERT INTO project_estimate_line_cost_items (
           id, project_id, estimate_id, estimate_line_id, division_code,
           division_name, cost_code, cost_code_name, description, quantity,
           unit, unit_cost_cents, direct_cost_cents,
           markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
           tax_code, tax_name, tax_rate_basis_points, tax_cents,
           line_total_cents, total_cost_cents, sort_order, created_at, updated_at
         )
         SELECT lower(hex(randomblob(16))), cost_item.project_id, ?,
           copied_line.id, cost_item.division_code, cost_item.division_name,
           cost_item.cost_code, cost_item.cost_code_name,
           cost_item.description, cost_item.quantity, cost_item.unit,
           cost_item.unit_cost_cents, cost_item.direct_cost_cents,
           cost_item.markup_rate_basis_points, cost_item.markup_cents,
           cost_item.taxable, cost_item.tax_entity_id, cost_item.tax_code,
           cost_item.tax_name, cost_item.tax_rate_basis_points,
           cost_item.tax_cents, cost_item.line_total_cents,
           cost_item.total_cost_cents, cost_item.sort_order, ?, ?
         FROM project_estimate_line_cost_items AS cost_item
         INNER JOIN project_estimate_lines AS source_line
           ON source_line.id = cost_item.estimate_line_id AND source_line.assembly_id = ?
         INNER JOIN project_estimate_lines AS copied_line
           ON copied_line.estimate_id = ?
           AND copied_line.sort_order = source_line.sort_order
           AND copied_line.cost_code = source_line.cost_code
           AND copied_line.description = source_line.description
         WHERE cost_item.estimate_id = ? AND cost_item.project_id = ?
           AND cost_item.deleted_at IS NULL`
      ).bind(id, now, now, assemblyId, id, estimateId, projectId),
      rawDb.prepare(
        `INSERT INTO project_estimate_phase_descriptions (id, project_id, estimate_id, division_code, description, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), project_id, ?, division_code, description, ?, ?
         FROM project_estimate_phase_descriptions WHERE estimate_id = ? AND project_id = ?`
      ).bind(id, now, now, estimateId, projectId),
      rawDb.prepare(
        `INSERT INTO project_estimate_acknowledgements (
           id, project_id, estimate_id, template_id, title, body, source_document_id, source_url, sort_order, created_at, updated_at
         )
         SELECT lower(hex(randomblob(16))), project_id, ?, template_id, title, body, source_document_id, source_url, sort_order, ?, ?
         FROM project_estimate_acknowledgements WHERE estimate_id = ? AND project_id = ?`
      ).bind(id, now, now, estimateId, projectId),
      rawDb.prepare(
        `INSERT INTO project_estimate_basis_documents (
           id, project_id, estimate_id, project_document_id, document_type, title, document_date,
           revision, drive_file_id, drive_url, notes, sort_order, created_at, updated_at
         )
         SELECT lower(hex(randomblob(16))), project_id, ?, project_document_id, document_type, title, document_date,
           revision, drive_file_id, drive_url, notes, sort_order, ?, ?
         FROM project_estimate_basis_documents WHERE estimate_id = ? AND project_id = ?`
      ).bind(id, now, now, estimateId, projectId),
  ])
}

/**
 * Inserts a change order unless one with the same id exists (inbound email
 * routing is replayed safely with deterministic ids).
 */
export async function insertChangeOrderIfAbsent(db: Db, values: ChangeOrderInsert): Promise<void> {
  await db
    .insert(projectChangeOrders)
    .values(values)
    .onConflictDoNothing({ target: projectChangeOrders.id })
}

/** Inserts a change-order history row unless one with the same id exists. */
export async function insertChangeOrderHistoryIfAbsent(db: Db, values: ChangeOrderHistoryInsert): Promise<void> {
  await db
    .insert(projectChangeOrderHistory)
    .values(values)
    .onConflictDoNothing({ target: projectChangeOrderHistory.id })
}

// ==== Named operations: assemblies, copies, report phases, contract packets, e-sign

/**
 * Inserts an estimate line from a `SELECT` (RFQ bid import), so the line is
 * only written when the select's guard holds inside the same batch.
 */
export function insertEstimateLineFromSelectStatement(db: Db, select: SQL): Statement {
  return db.insert(projectEstimateLines).select(select)
}

/**
 * Cancels a signature request that was prepared for the estimate, so the
 * client never signs figures that changed after preparation.
 */
export function invalidatePreparedSignatureStatement(db: Db, estimateId: string, now: string): Statement {
  return db.update(projectEstimates).set({
    foxitStatus: "not_started",
    foxitEnvelopeId: null,
    foxitEmbeddedSessionUrl: null,
    foxitPreparedSourceHash: null,
    foxitPreparedAt: null,
    updatedAt: now,
  }).where(eq(projectEstimates.id, estimateId))
}

/**
 * A newly executed contract packet replaces the job's other accepted
 * contract estimates. Change-order and phase estimates aren't part of the
 * contract and stay as they are.
 */
export function supersedeOtherContractEstimatesStatement(
  db: Db,
  projectId: string,
  keptEstimateId: string,
  now: string
): Statement {
  return db
    .update(projectEstimates)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(projectEstimates.projectId, projectId),
        eq(projectEstimates.status, "accepted"),
        ne(projectEstimates.id, keptEstimateId),
        ...contractEstimateConditions()
      )
    )
}
