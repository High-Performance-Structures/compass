/**
 * Company (vendor or client) merges: what a merge would move, what blocks
 * it, and the statements that move every reference to the kept company in
 * one atomic batch. Each owning domain store builds the statement for its own
 * table (one writer per table); this module only orders them. The list of
 * references and how each is handled is in company-merge-references.ts.
 *
 * The same moves repair a company merged before every reference moved
 * (`companyMergeRepairStatements`, used by scripts/repair-company-merge.mjs).
 */
import { activityEventSelectStatement, companyMergeActivityStatements } from "@/lib/activity-log"
import { companyMergeBudgetLineStatements } from "@/lib/domain/budget/store"
import { companyMergeEmailThreadStatements } from "@/lib/domain/correspondence/email-store"
import { companyMergeTradeDocStatements } from "@/lib/domain/documents/store"
import { companyMergeFinancialStatements } from "@/lib/domain/financials/store"
import { companyMergeOperationStatements } from "@/lib/domain/operations/store"
import { companyMergeProjectStatements } from "@/lib/domain/project/store"
import { companyMergeTradeLetterStatements } from "@/lib/domain/trade-letters/store"
import { companyMergeWarrantyStatements } from "@/lib/domain/warranty/store"
import { isRecord } from "@/lib/shared/guards"

import {
  COMPANY_MERGE_CATEGORIES,
  COMPANY_MERGE_CATEGORY_LABELS,
  companyMoveGuard,
  companyReferencesFor,
  type CompanyMergeCategory,
  type CompanyMergeSide,
  type CompanyReferenceMove,
} from "./company-merge-references"
import {
  companyContactMoveStatements,
  companyMarkMergedStatement,
  contactMergeEventStatement,
  type ContactMergeWrite,
} from "./store"

type SqlPart = { readonly sql: string; readonly binds: readonly unknown[] }
type CompanyPair = {
  readonly side: CompanyMergeSide
  readonly organizationId: string
  readonly sourceId: string
  readonly destinationId: string
}

/** Every reference move, children before parents, all guarded by the pair's state. */
export function companyReferenceMoveStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  return [
    ...companyContactMoveStatements(database, move),
    ...companyMergeTradeDocStatements(database, move),
    ...companyMergeOperationStatements(database, move),
    ...companyMergeBudgetLineStatements(database, move),
    ...companyMergeWarrantyStatements(database, move),
    ...companyMergeTradeLetterStatements(database, move),
    ...companyMergeFinancialStatements(database, move),
    ...companyMergeProjectStatements(database, move),
    ...companyMergeEmailThreadStatements(database, move),
    ...companyMergeActivityStatements(database, move),
  ]
}

/** One atomic company merge: the audit event, every reference move, then the source is archived. */
export function companyMergeStatements(
  database: D1Database,
  input: ContactMergeWrite & { readonly kind: "customer_company" | "vendor_company" }
): D1PreparedStatement[] {
  const move: CompanyReferenceMove = {
    side: input.kind === "vendor_company" ? "vendor" : "customer",
    mode: "merge",
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    destinationId: input.destinationId,
    now: input.now,
  }
  return [contactMergeEventStatement(database, input), ...companyReferenceMoveStatements(database, move), companyMarkMergedStatement(database, move)]
}

/**
 * A JSON object of how many rows in each moved category still point at
 * `sourceId`, computed by SQL. Rows matched on two columns of one table
 * (project contacts) count once.
 */
export function companyReferenceCountsSql(side: CompanyMergeSide, sourceId: string): SqlPart {
  const binds: unknown[] = []
  const parts = COMPANY_MERGE_CATEGORIES.flatMap((category) => {
    const references = companyReferencesFor(side).filter((reference) => reference.handling.action === "move" && reference.handling.category === category)
    if (references.length === 0) return []
    const tables = [...new Set(references.map((reference) => reference.table))]
    const counts = tables.map((table) => {
      const conditions = references.filter((reference) => reference.table === table).map((reference) => {
        binds.push(sourceId)
        return reference.when ? `(${reference.column} = ? AND ${reference.when})` : `${reference.column} = ?`
      })
      return `(SELECT count(*) FROM ${table} WHERE ${conditions.join(" OR ")})`
    })
    return [`'${category}', ${counts.join(" + ")}`]
  })
  return { sql: `json_object(${parts.join(", ")})`, binds }
}

function isCategory(value: string): value is CompanyMergeCategory {
  return COMPANY_MERGE_CATEGORIES.some((category) => category === value)
}

export type CompanyMergeCount = { readonly category: CompanyMergeCategory; readonly label: string; readonly count: number }

/** Non-zero reference counts, in display order. */
async function companyReferenceCounts(database: D1Database, side: CompanyMergeSide, sourceId: string): Promise<CompanyMergeCount[]> {
  const counts = companyReferenceCountsSql(side, sourceId)
  const row = await database.prepare(`SELECT ${counts.sql} AS counts`).bind(...counts.binds).first()
  const parsed: unknown = isRecord(row) && typeof row.counts === "string" ? JSON.parse(row.counts) : null
  if (!isRecord(parsed)) return []
  return Object.entries(parsed).flatMap(([category, count]) =>
    isCategory(category) && typeof count === "number" && count > 0
      ? [{ category, label: COMPANY_MERGE_CATEGORY_LABELS[category], count }]
      : [])
}

type TradeDocRow = { readonly id: string; readonly docType: string; readonly driveFileId: string | null; readonly current: boolean }

/** What the trade-doc moves will do with each document (mirrors companyMergeTradeDocStatements). */
export type TradeDocMergePlan = {
  /** Documents that move to the kept vendor. */
  readonly moved: readonly string[]
  /** Archived vendor's current documents that move as history: the kept vendor's current document of that type wins. */
  readonly becomeHistory: readonly string[]
  /** The same Drive file and type the kept vendor already holds; this copy stays on the archived record. */
  readonly keptOnArchive: readonly string[]
  /** The kept vendor's copy of a file that was current only on the archived vendor; it becomes current again. */
  readonly restoredOnKept: readonly string[]
}

export function planTradeDocMerge(source: readonly TradeDocRow[], destination: readonly TradeDocRow[]): TradeDocMergePlan {
  const fileKey = (row: TradeDocRow): string => `${row.docType}\u0000${row.driveFileId ?? ""}`
  const destinationFiles = new Map(destination.filter((row) => row.driveFileId).map((row) => [fileKey(row), row]))
  const currentTypes = new Set(destination.filter((row) => row.current).map((row) => row.docType))
  const restoredOnKept: string[] = []
  for (const row of source) {
    const copy = row.current && row.driveFileId ? destinationFiles.get(fileKey(row)) : undefined
    if (copy && !copy.current && !currentTypes.has(row.docType)) {
      restoredOnKept.push(copy.id)
      currentTypes.add(row.docType)
    }
  }
  const keptOnArchive = source.filter((row) => row.driveFileId && destinationFiles.has(fileKey(row))).map((row) => row.id)
  const kept = new Set(keptOnArchive)
  return {
    moved: source.filter((row) => !kept.has(row.id)).map((row) => row.id),
    becomeHistory: source.filter((row) => !kept.has(row.id) && row.current && currentTypes.has(row.docType)).map((row) => row.id),
    keptOnArchive,
    restoredOnKept,
  }
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

async function rows(database: D1Database, query: string, ...binds: readonly unknown[]): Promise<Record<string, unknown>[]> {
  const result = await database.prepare(query).bind(...binds).all()
  return result.results.filter(isRecord)
}

async function tradeDocPlan(database: D1Database, pair: CompanyPair): Promise<TradeDocMergePlan> {
  const docs = await rows(database, `SELECT id, vendor_id, doc_type, drive_file_id, superseded_at FROM vendor_trade_documents
    WHERE vendor_id IN (?, ?) AND organization_id = ? ORDER BY id`, pair.sourceId, pair.destinationId, pair.organizationId)
  const toRow = (row: Record<string, unknown>): TradeDocRow => ({
    id: String(row.id), docType: String(row.doc_type), driveFileId: text(row, "drive_file_id"), current: row.superseded_at === null,
  })
  return planTradeDocMerge(
    docs.filter((row) => row.vendor_id === pair.sourceId).map(toRow),
    docs.filter((row) => row.vendor_id === pair.destinationId).map(toRow))
}

export type CompanyMergeDetails = {
  readonly moves: readonly CompanyMergeCount[]
  readonly tradeDocs: TradeDocMergePlan
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
}

const ACTIVE_CERTIFICATE_SYNC = ["queued", "running"]

/**
 * What a company merge would move, and what must be settled first. Reads
 * only; the caller adds these blockers to the directory-level ones.
 */
export async function inspectCompanyMerge(database: D1Database, pair: CompanyPair): Promise<CompanyMergeDetails> {
  const blockers: string[] = []
  const warnings: string[] = []
  const vendor = pair.side === "vendor"
  const [moves, tradeDocs] = await Promise.all([
    companyReferenceCounts(database, pair.side, pair.sourceId),
    vendor ? tradeDocPlan(database, pair) : Promise.resolve({ moved: [], becomeHistory: [], keptOnArchive: [], restoredOnKept: [] }),
  ])
  if (vendor) {
    const [settings, syncs, operations, financial] = await Promise.all([
      rows(database, "SELECT id, trade_docs_folder_id, trade_docs_bill_mode FROM vendors WHERE id IN (?, ?) AND organization_id = ?",
        pair.sourceId, pair.destinationId, pair.organizationId),
      rows(database, "SELECT status FROM sage_vendor_certificate_syncs WHERE vendor_id = ?", pair.sourceId),
      rows(database, `SELECT count(*) AS n FROM project_operations WHERE vendor_id = ? AND sage_vendor_id IS NOT NULL AND trim(sage_vendor_id) <> ''
        AND NOT EXISTS (SELECT 1 FROM vendors k WHERE k.id = ? AND (k.sage_vendor_id = project_operations.sage_vendor_id OR k.sage_vendor_number = project_operations.sage_vendor_id))`,
      pair.sourceId, pair.destinationId),
      rows(database, `SELECT (SELECT count(*) FROM vendor_bills WHERE vendor_id = ? AND netsuite_id IS NOT NULL)
        + (SELECT count(*) FROM payments WHERE vendor_id = ? AND netsuite_id IS NOT NULL) AS n`, pair.sourceId, pair.sourceId),
    ])
    const source = settings.find((row) => row.id === pair.sourceId)
    const destination = settings.find((row) => row.id === pair.destinationId)
    const sourceMode = source ? text(source, "trade_docs_bill_mode") : null
    const destinationMode = destination ? text(destination, "trade_docs_bill_mode") : null
    if (sourceMode && destinationMode && sourceMode !== destinationMode) {
      blockers.push(`The vendors have different trade-docs bill settings (${destinationMode} kept, ${sourceMode} archived). Choose the same setting on both before merging.`)
    }
    const sourceFolder = source ? text(source, "trade_docs_folder_id") : null
    const destinationFolder = destination ? text(destination, "trade_docs_folder_id") : null
    if (sourceFolder && destinationFolder && sourceFolder !== destinationFolder) {
      warnings.push("Both vendors have a trade-docs Drive folder. The kept vendor keeps its folder; moved documents keep their own Drive links, but files in the archived vendor's folder are not moved in Drive.")
    }
    if (syncs.some((row) => typeof row.status === "string" && ACTIVE_CERTIFICATE_SYNC.includes(row.status))) {
      blockers.push("A Sage certificate sync is queued or running for the vendor to archive. Wait for it to finish before merging.")
    }
    const mismatched = Number(operations[0]?.n ?? 0)
    if (mismatched > 0) {
      blockers.push(`${mismatched} PO${mismatched === 1 ? "" : "s"} or RFQ${mismatched === 1 ? "" : "s"} on the vendor to archive carry a Sage vendor the kept vendor does not have. Reconcile them in Sage first.`)
    }
    if (Number(financial[0]?.n ?? 0) > 0) {
      blockers.push("Bills or payments on the vendor to archive are linked to NetSuite. Keep the vendor that owns those accounting records.")
    }
    if (tradeDocs.becomeHistory.length > 0) {
      warnings.push(`${tradeDocs.becomeHistory.length} current trade doc${tradeDocs.becomeHistory.length === 1 ? "" : "s"} of the archived vendor will move as history, because the kept vendor already has a current document of that type.`)
    }
    if (tradeDocs.keptOnArchive.length > 0) {
      warnings.push(`${tradeDocs.keptOnArchive.length} trade doc${tradeDocs.keptOnArchive.length === 1 ? " is" : "s are"} the same Drive file the kept vendor already has; that copy stays with the archived record.`)
    }
  } else {
    const financial = await rows(database, `SELECT (SELECT count(*) FROM invoices WHERE customer_id = ? AND netsuite_id IS NOT NULL)
      + (SELECT count(*) FROM credit_memos WHERE customer_id = ? AND netsuite_id IS NOT NULL)
      + (SELECT count(*) FROM payments WHERE customer_id = ? AND netsuite_id IS NOT NULL) AS n`, pair.sourceId, pair.sourceId, pair.sourceId)
    if (Number(financial[0]?.n ?? 0) > 0) {
      blockers.push("Invoices, credit memos or payments on the client to archive are linked to NetSuite. Keep the client that owns those accounting records.")
    }
  }
  return { moves, tradeDocs, blockers, warnings }
}

/**
 * Moves what a past merge left on the archived company to the company it was
 * merged into, with the same statements as a merge. Every statement does
 * nothing unless the source is merged into the destination, so a partial or
 * repeated run is safe. The first statement records what is about to move as
 * an activity event of action `<kind>_repair` on the kept company (the merge
 * audit table only accepts merge kinds), and only while something is left.
 */
export function companyMergeRepairStatements(database: D1Database, input: CompanyPair & { readonly now: string }): D1PreparedStatement[] {
  const move: CompanyReferenceMove = { ...input, mode: "repair" }
  const kind = `${input.side}_company_repair`
  const guard = companyMoveGuard(move)
  const counts = companyReferenceCountsSql(input.side, input.sourceId)
  const remaining = companyReferencesFor(input.side).filter((reference) => reference.handling.action === "move")
  const event = activityEventSelectStatement(database, {
    organizationId: input.organizationId,
    actorUserId: null,
    actorName: "Company merge repair",
    actorRole: "system",
    category: "account",
    action: kind,
    entityType: input.side,
    entityId: input.destinationId,
    summary: `Moved records a past merge left on the archived ${input.side === "vendor" ? "vendor" : "client"} to the ${input.side === "vendor" ? "vendor" : "client"} it was merged into.`,
    metadata: { sql: `json_object('kind', ?, 'sourceId', ?, 'destinationId', ?, 'remaining', ${counts.sql})`, binds: [kind, input.sourceId, input.destinationId, ...counts.binds] },
    condition: {
      sql: `${guard.sql} AND (${remaining.map((reference) =>
        `EXISTS (SELECT 1 FROM ${reference.table} WHERE ${reference.column} = ?${reference.when ? ` AND ${reference.when}` : ""})`).join(" OR ")})`,
      binds: [...guard.binds, ...remaining.map(() => input.sourceId)],
    },
    now: input.now,
  })
  return [event, ...companyReferenceMoveStatements(database, move)]
}
