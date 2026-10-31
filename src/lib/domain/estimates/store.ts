import type { SQL } from "drizzle-orm"
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

export type EstimateInsert = typeof projectEstimates.$inferInsert
export type EstimatePatch = SQLiteUpdateSetSource<typeof projectEstimates>

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

export type EstimateLineInsert = typeof projectEstimateLines.$inferInsert
export type EstimateLinePatch = SQLiteUpdateSetSource<typeof projectEstimateLines>

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

export type EstimateAssemblyInsert = typeof projectEstimateAssemblies.$inferInsert
export type EstimateAssemblyPatch = SQLiteUpdateSetSource<typeof projectEstimateAssemblies>

export function insertEstimateAssemblyStatement(db: Db, values: EstimateAssemblyInsert | readonly EstimateAssemblyInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateAssemblies).values([...values]) : db.insert(projectEstimateAssemblies).values(values)
}

export async function insertEstimateAssembly(db: Db, values: EstimateAssemblyInsert | readonly EstimateAssemblyInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateAssemblies).values([...values]).run() : db.insert(projectEstimateAssemblies).values(values).run()
}

export function updateEstimateAssembliesStatement(db: Db, where: SQL | undefined, patch: EstimateAssemblyPatch): Statement {
  return db.update(projectEstimateAssemblies).set(patch).where(where)
}

export async function updateEstimateAssemblies(db: Db, where: SQL | undefined, patch: EstimateAssemblyPatch): Promise<D1Result> {
  return db.update(projectEstimateAssemblies).set(patch).where(where).run()
}

export function deleteEstimateAssembliesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateAssemblies).where(where)
}

export async function deleteEstimateAssemblies(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateAssemblies).where(where).run()
}

// ---- projectEstimateAssemblyCopies

export type EstimateAssemblyCopyInsert = typeof projectEstimateAssemblyCopies.$inferInsert
export type EstimateAssemblyCopyPatch = SQLiteUpdateSetSource<typeof projectEstimateAssemblyCopies>

export function insertEstimateAssemblyCopyStatement(db: Db, values: EstimateAssemblyCopyInsert | readonly EstimateAssemblyCopyInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateAssemblyCopies).values([...values]) : db.insert(projectEstimateAssemblyCopies).values(values)
}

export async function insertEstimateAssemblyCopy(db: Db, values: EstimateAssemblyCopyInsert | readonly EstimateAssemblyCopyInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateAssemblyCopies).values([...values]).run() : db.insert(projectEstimateAssemblyCopies).values(values).run()
}

export function updateEstimateAssemblyCopiesStatement(db: Db, where: SQL | undefined, patch: EstimateAssemblyCopyPatch): Statement {
  return db.update(projectEstimateAssemblyCopies).set(patch).where(where)
}

export async function updateEstimateAssemblyCopies(db: Db, where: SQL | undefined, patch: EstimateAssemblyCopyPatch): Promise<D1Result> {
  return db.update(projectEstimateAssemblyCopies).set(patch).where(where).run()
}

export function deleteEstimateAssemblyCopiesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateAssemblyCopies).where(where)
}

export async function deleteEstimateAssemblyCopies(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateAssemblyCopies).where(where).run()
}

// ---- projectEstimateLineCostItems

export type EstimateLineCostItemInsert = typeof projectEstimateLineCostItems.$inferInsert
export type EstimateLineCostItemPatch = SQLiteUpdateSetSource<typeof projectEstimateLineCostItems>

export function insertEstimateLineCostItemStatement(db: Db, values: EstimateLineCostItemInsert | readonly EstimateLineCostItemInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateLineCostItems).values([...values]) : db.insert(projectEstimateLineCostItems).values(values)
}

export async function insertEstimateLineCostItem(db: Db, values: EstimateLineCostItemInsert | readonly EstimateLineCostItemInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateLineCostItems).values([...values]).run() : db.insert(projectEstimateLineCostItems).values(values).run()
}

export function updateEstimateLineCostItemsStatement(db: Db, where: SQL | undefined, patch: EstimateLineCostItemPatch): Statement {
  return db.update(projectEstimateLineCostItems).set(patch).where(where)
}

export async function updateEstimateLineCostItems(db: Db, where: SQL | undefined, patch: EstimateLineCostItemPatch): Promise<D1Result> {
  return db.update(projectEstimateLineCostItems).set(patch).where(where).run()
}

export function deleteEstimateLineCostItemsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateLineCostItems).where(where)
}

export async function deleteEstimateLineCostItems(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateLineCostItems).where(where).run()
}

// ---- projectEstimateReportPhases

export type EstimateReportPhaseInsert = typeof projectEstimateReportPhases.$inferInsert
export type EstimateReportPhasePatch = SQLiteUpdateSetSource<typeof projectEstimateReportPhases>

export function insertEstimateReportPhaseStatement(db: Db, values: EstimateReportPhaseInsert | readonly EstimateReportPhaseInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateReportPhases).values([...values]) : db.insert(projectEstimateReportPhases).values(values)
}

export async function insertEstimateReportPhase(db: Db, values: EstimateReportPhaseInsert | readonly EstimateReportPhaseInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateReportPhases).values([...values]).run() : db.insert(projectEstimateReportPhases).values(values).run()
}

export function updateEstimateReportPhasesStatement(db: Db, where: SQL | undefined, patch: EstimateReportPhasePatch): Statement {
  return db.update(projectEstimateReportPhases).set(patch).where(where)
}

export async function updateEstimateReportPhases(db: Db, where: SQL | undefined, patch: EstimateReportPhasePatch): Promise<D1Result> {
  return db.update(projectEstimateReportPhases).set(patch).where(where).run()
}

export function deleteEstimateReportPhasesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateReportPhases).where(where)
}

export async function deleteEstimateReportPhases(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateReportPhases).where(where).run()
}

// ---- projectEstimatePhaseDescriptions

export type EstimatePhaseDescriptionInsert = typeof projectEstimatePhaseDescriptions.$inferInsert
export type EstimatePhaseDescriptionPatch = SQLiteUpdateSetSource<typeof projectEstimatePhaseDescriptions>

export function insertEstimatePhaseDescriptionStatement(db: Db, values: EstimatePhaseDescriptionInsert | readonly EstimatePhaseDescriptionInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimatePhaseDescriptions).values([...values]) : db.insert(projectEstimatePhaseDescriptions).values(values)
}

export async function insertEstimatePhaseDescription(db: Db, values: EstimatePhaseDescriptionInsert | readonly EstimatePhaseDescriptionInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimatePhaseDescriptions).values([...values]).run() : db.insert(projectEstimatePhaseDescriptions).values(values).run()
}

export function updateEstimatePhaseDescriptionsStatement(db: Db, where: SQL | undefined, patch: EstimatePhaseDescriptionPatch): Statement {
  return db.update(projectEstimatePhaseDescriptions).set(patch).where(where)
}

export async function updateEstimatePhaseDescriptions(db: Db, where: SQL | undefined, patch: EstimatePhaseDescriptionPatch): Promise<D1Result> {
  return db.update(projectEstimatePhaseDescriptions).set(patch).where(where).run()
}

export function deleteEstimatePhaseDescriptionsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimatePhaseDescriptions).where(where)
}

export async function deleteEstimatePhaseDescriptions(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimatePhaseDescriptions).where(where).run()
}

// ---- projectEstimateAcknowledgements

export type EstimateAcknowledgementInsert = typeof projectEstimateAcknowledgements.$inferInsert
export type EstimateAcknowledgementPatch = SQLiteUpdateSetSource<typeof projectEstimateAcknowledgements>

export function insertEstimateAcknowledgementStatement(db: Db, values: EstimateAcknowledgementInsert | readonly EstimateAcknowledgementInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateAcknowledgements).values([...values]) : db.insert(projectEstimateAcknowledgements).values(values)
}

export async function insertEstimateAcknowledgement(db: Db, values: EstimateAcknowledgementInsert | readonly EstimateAcknowledgementInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateAcknowledgements).values([...values]).run() : db.insert(projectEstimateAcknowledgements).values(values).run()
}

export function updateEstimateAcknowledgementsStatement(db: Db, where: SQL | undefined, patch: EstimateAcknowledgementPatch): Statement {
  return db.update(projectEstimateAcknowledgements).set(patch).where(where)
}

export async function updateEstimateAcknowledgements(db: Db, where: SQL | undefined, patch: EstimateAcknowledgementPatch): Promise<D1Result> {
  return db.update(projectEstimateAcknowledgements).set(patch).where(where).run()
}

export function deleteEstimateAcknowledgementsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateAcknowledgements).where(where)
}

export async function deleteEstimateAcknowledgements(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateAcknowledgements).where(where).run()
}

// ---- projectEstimateBasisDocuments

export type EstimateBasisDocumentInsert = typeof projectEstimateBasisDocuments.$inferInsert
export type EstimateBasisDocumentPatch = SQLiteUpdateSetSource<typeof projectEstimateBasisDocuments>

export function insertEstimateBasisDocumentStatement(db: Db, values: EstimateBasisDocumentInsert | readonly EstimateBasisDocumentInsert[]): Statement {
  return isRows(values) ? db.insert(projectEstimateBasisDocuments).values([...values]) : db.insert(projectEstimateBasisDocuments).values(values)
}

export async function insertEstimateBasisDocument(db: Db, values: EstimateBasisDocumentInsert | readonly EstimateBasisDocumentInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectEstimateBasisDocuments).values([...values]).run() : db.insert(projectEstimateBasisDocuments).values(values).run()
}

export function updateEstimateBasisDocumentsStatement(db: Db, where: SQL | undefined, patch: EstimateBasisDocumentPatch): Statement {
  return db.update(projectEstimateBasisDocuments).set(patch).where(where)
}

export async function updateEstimateBasisDocuments(db: Db, where: SQL | undefined, patch: EstimateBasisDocumentPatch): Promise<D1Result> {
  return db.update(projectEstimateBasisDocuments).set(patch).where(where).run()
}

export function deleteEstimateBasisDocumentsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectEstimateBasisDocuments).where(where)
}

export async function deleteEstimateBasisDocuments(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectEstimateBasisDocuments).where(where).run()
}

// ---- projectPhaseProposals

export type PhaseProposalInsert = typeof projectPhaseProposals.$inferInsert
export type PhaseProposalPatch = SQLiteUpdateSetSource<typeof projectPhaseProposals>

export function insertPhaseProposalStatement(db: Db, values: PhaseProposalInsert | readonly PhaseProposalInsert[]): Statement {
  return isRows(values) ? db.insert(projectPhaseProposals).values([...values]) : db.insert(projectPhaseProposals).values(values)
}

export async function insertPhaseProposal(db: Db, values: PhaseProposalInsert | readonly PhaseProposalInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectPhaseProposals).values([...values]).run() : db.insert(projectPhaseProposals).values(values).run()
}

export function updatePhaseProposalsStatement(db: Db, where: SQL | undefined, patch: PhaseProposalPatch): Statement {
  return db.update(projectPhaseProposals).set(patch).where(where)
}

export async function updatePhaseProposals(db: Db, where: SQL | undefined, patch: PhaseProposalPatch): Promise<D1Result> {
  return db.update(projectPhaseProposals).set(patch).where(where).run()
}

export function deletePhaseProposalsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectPhaseProposals).where(where)
}

export async function deletePhaseProposals(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectPhaseProposals).where(where).run()
}

// ---- projectChangeOrders

export type ChangeOrderInsert = typeof projectChangeOrders.$inferInsert
export type ChangeOrderPatch = SQLiteUpdateSetSource<typeof projectChangeOrders>

export function insertChangeOrderStatement(db: Db, values: ChangeOrderInsert | readonly ChangeOrderInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrders).values([...values]) : db.insert(projectChangeOrders).values(values)
}

export async function insertChangeOrder(db: Db, values: ChangeOrderInsert | readonly ChangeOrderInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectChangeOrders).values([...values]).run() : db.insert(projectChangeOrders).values(values).run()
}

export function updateChangeOrdersStatement(db: Db, where: SQL | undefined, patch: ChangeOrderPatch): Statement {
  return db.update(projectChangeOrders).set(patch).where(where)
}

export async function updateChangeOrders(db: Db, where: SQL | undefined, patch: ChangeOrderPatch): Promise<D1Result> {
  return db.update(projectChangeOrders).set(patch).where(where).run()
}

export function deleteChangeOrdersStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrders).where(where)
}

export async function deleteChangeOrders(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectChangeOrders).where(where).run()
}

// ---- projectChangeOrderLines

export type ChangeOrderLineInsert = typeof projectChangeOrderLines.$inferInsert
export type ChangeOrderLinePatch = SQLiteUpdateSetSource<typeof projectChangeOrderLines>

export function insertChangeOrderLineStatement(db: Db, values: ChangeOrderLineInsert | readonly ChangeOrderLineInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderLines).values([...values]) : db.insert(projectChangeOrderLines).values(values)
}

export async function insertChangeOrderLine(db: Db, values: ChangeOrderLineInsert | readonly ChangeOrderLineInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectChangeOrderLines).values([...values]).run() : db.insert(projectChangeOrderLines).values(values).run()
}

export function updateChangeOrderLinesStatement(db: Db, where: SQL | undefined, patch: ChangeOrderLinePatch): Statement {
  return db.update(projectChangeOrderLines).set(patch).where(where)
}

export async function updateChangeOrderLines(db: Db, where: SQL | undefined, patch: ChangeOrderLinePatch): Promise<D1Result> {
  return db.update(projectChangeOrderLines).set(patch).where(where).run()
}

export function deleteChangeOrderLinesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrderLines).where(where)
}

export async function deleteChangeOrderLines(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectChangeOrderLines).where(where).run()
}

// ---- projectChangeOrderDocuments

export type ChangeOrderDocumentInsert = typeof projectChangeOrderDocuments.$inferInsert
export type ChangeOrderDocumentPatch = SQLiteUpdateSetSource<typeof projectChangeOrderDocuments>

export function insertChangeOrderDocumentStatement(db: Db, values: ChangeOrderDocumentInsert | readonly ChangeOrderDocumentInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderDocuments).values([...values]) : db.insert(projectChangeOrderDocuments).values(values)
}

export async function insertChangeOrderDocument(db: Db, values: ChangeOrderDocumentInsert | readonly ChangeOrderDocumentInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectChangeOrderDocuments).values([...values]).run() : db.insert(projectChangeOrderDocuments).values(values).run()
}

export function updateChangeOrderDocumentsStatement(db: Db, where: SQL | undefined, patch: ChangeOrderDocumentPatch): Statement {
  return db.update(projectChangeOrderDocuments).set(patch).where(where)
}

export async function updateChangeOrderDocuments(db: Db, where: SQL | undefined, patch: ChangeOrderDocumentPatch): Promise<D1Result> {
  return db.update(projectChangeOrderDocuments).set(patch).where(where).run()
}

export function deleteChangeOrderDocumentsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrderDocuments).where(where)
}

export async function deleteChangeOrderDocuments(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectChangeOrderDocuments).where(where).run()
}

// ---- projectChangeOrderHistory

export type ChangeOrderHistoryInsert = typeof projectChangeOrderHistory.$inferInsert
export type ChangeOrderHistoryPatch = SQLiteUpdateSetSource<typeof projectChangeOrderHistory>

export function insertChangeOrderHistoryStatement(db: Db, values: ChangeOrderHistoryInsert | readonly ChangeOrderHistoryInsert[]): Statement {
  return isRows(values) ? db.insert(projectChangeOrderHistory).values([...values]) : db.insert(projectChangeOrderHistory).values(values)
}

export async function insertChangeOrderHistory(db: Db, values: ChangeOrderHistoryInsert | readonly ChangeOrderHistoryInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectChangeOrderHistory).values([...values]).run() : db.insert(projectChangeOrderHistory).values(values).run()
}

export function updateChangeOrderHistoryStatement(db: Db, where: SQL | undefined, patch: ChangeOrderHistoryPatch): Statement {
  return db.update(projectChangeOrderHistory).set(patch).where(where)
}

export async function updateChangeOrderHistory(db: Db, where: SQL | undefined, patch: ChangeOrderHistoryPatch): Promise<D1Result> {
  return db.update(projectChangeOrderHistory).set(patch).where(where).run()
}

export function deleteChangeOrderHistoryStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectChangeOrderHistory).where(where)
}

export async function deleteChangeOrderHistory(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectChangeOrderHistory).where(where).run()
}

function isRows<T>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ==== Named operations: estimates (workspace, drafts, imports, lines, acceptance)

// ==== Named operations: change orders and phase proposals

// ==== Named operations: assemblies, copies, report phases, contract packets, e-sign
