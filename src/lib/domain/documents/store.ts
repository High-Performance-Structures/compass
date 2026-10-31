import { and, eq, isNull, lt, ne, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteInsert, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { contractPacketDocuments, contractPackets } from "@/db/schema-contracts"
import { projectDocuments } from "@/db/schema-documents"
import {
  projectRecordDriveFiles,
  projectRecordDriveSnapshots,
  type PaperTrailRecordType,
} from "@/db/schema-paper-trail"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { projectArchiveDocuments, projectArchiveRecipients } from "@/db/schema-project-archives"
import { projectLinks } from "@/db/schema-project-links"
import { vendorTradeDocLinks, vendorTradeDocuments } from "@/db/schema-trade-docs"
import { chunkD1InsertRows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

/*
 * The documents domain store: the only code that inserts, updates or deletes
 * paper-trail Drive copies, published project documents, Buildertrend
 * archive editions, linked jobs, vendor trade documents and their upload
 * links, source-record participants, and
 * contract packets (architecture standard, section 1).
 *
 * `*Statement` builds an unexecuted statement for `db.batch`; the plain form
 * runs it. Callers pass the same `where` conditions they used before, so the
 * SQL is unchanged. No access rules here; callers check access first.
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

// ---- Paper trail: project_record_drive_files / project_record_drive_snapshots

type RecordDriveFileInsert = typeof projectRecordDriveFiles.$inferInsert
type RecordDriveFilePatch = SQLiteUpdateSetSource<typeof projectRecordDriveFiles>
type RecordDriveSnapshotPatch = SQLiteUpdateSetSource<typeof projectRecordDriveSnapshots>

/** Statuses a re-queue leaves alone: staff chose them, or the record is gone. */
const HELD_STATUSES = sql`('removed', 'needs_choice', 'kept_existing')`

export async function insertRecordDriveFile(db: Db, values: RecordDriveFileInsert): Promise<D1Result> {
  return db.insert(projectRecordDriveFiles).values(values).run()
}

export async function updateRecordDriveFile(db: Db, id: string, patch: RecordDriveFilePatch): Promise<D1Result> {
  return db.update(projectRecordDriveFiles).set(patch).where(eq(projectRecordDriveFiles.id, id)).run()
}

/** Updates the rows `where` matches and returns their ids. */
export async function updateRecordDriveFilesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: RecordDriveFilePatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectRecordDriveFiles).set(patch).where(where).returning({ id: projectRecordDriveFiles.id })
}

/**
 * Queues one record's living copy (one upsert, keyed on the record). Only for
 * projects in a company and not internal workspaces, which have no folders.
 */
export async function upsertRecordDriveFileDue(
  db: Db,
  input: { readonly projectId: string; readonly recordType: PaperTrailRecordType; readonly recordId: string; readonly now: string },
): Promise<void> {
  const { now } = input
  await db.run(sql`
      INSERT INTO project_record_drive_files
        (id, organization_id, project_id, record_type, record_id, status, due_at, changed_at, attempts, created_at, updated_at)
      SELECT ${crypto.randomUUID()}, p.organization_id, p.id, ${input.recordType}, ${input.recordId}, 'pending', ${now}, ${now}, 0, ${now}, ${now}
      FROM projects p
      WHERE p.id = ${input.projectId} AND p.organization_id IS NOT NULL AND p.workspace_kind IS NULL
      ON CONFLICT (record_type, record_id) DO UPDATE SET
        status = CASE WHEN status IN ${HELD_STATUSES} THEN status ELSE 'pending' END,
        due_at = excluded.due_at,
        changed_at = excluded.changed_at,
        attempts = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `)
}

/** Requests one milestone copy; an existing request for the same milestone wins. */
export async function insertRecordDriveSnapshotDue(
  db: Db,
  input: {
    readonly projectId: string
    readonly recordType: PaperTrailRecordType
    readonly recordId: string
    readonly milestone: string
    readonly now: string
  },
): Promise<void> {
  const { now } = input
  await db.run(sql`
        INSERT INTO project_record_drive_snapshots
          (id, organization_id, project_id, record_type, record_id, milestone, milestone_at, status, requested_at, attempts)
        SELECT ${crypto.randomUUID()}, p.organization_id, p.id, ${input.recordType}, ${input.recordId}, ${input.milestone}, ${now}, 'pending', ${now}, 0
        FROM projects p
        WHERE p.id = ${input.projectId} AND p.organization_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `)
}

/** Deleted records keep their last Drive copy; the job stops refreshing them. */
export async function markRecordDriveFileRemoved(
  db: Db,
  input: { readonly recordType: PaperTrailRecordType; readonly recordId: string; readonly now: string },
): Promise<void> {
  await db.run(sql`
      UPDATE project_record_drive_files
      SET status = 'removed', updated_at = ${input.now}
      WHERE record_type = ${input.recordType} AND record_id = ${input.recordId}
    `)
}

/**
 * The sweep's queue step for one record type: every record in `changedRows`
 * (id, project_id, changed) whose sheet changed since its last copy, limited
 * to the projects `projectScope` allows (alias `p`).
 */
export async function queueChangedRecordDriveFiles(
  db: Db,
  input: { readonly recordType: PaperTrailRecordType; readonly changedRows: SQL; readonly projectScope: SQL; readonly stamp: string },
): Promise<void> {
  const { recordType, stamp } = input
  await db.run(sql`
      INSERT INTO project_record_drive_files
        (id, organization_id, project_id, record_type, record_id, status, due_at, changed_at, source_changed_at, attempts, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), p.organization_id, x.project_id, ${recordType}, x.id, 'pending', ${stamp}, x.changed, x.changed, 0, ${stamp}, ${stamp}
      FROM (${input.changedRows}) x
      JOIN projects p ON p.id = x.project_id
      LEFT JOIN project_record_drive_files f ON f.record_type = ${recordType} AND f.record_id = x.id
      WHERE ${input.projectScope}
        AND (f.id IS NULL OR (f.status NOT IN ${HELD_STATUSES} AND x.changed > coalesce(f.source_changed_at, '')))
      ON CONFLICT (record_type, record_id) DO UPDATE SET
        status = 'pending',
        due_at = excluded.due_at,
        changed_at = max(project_record_drive_files.changed_at, excluded.changed_at),
        source_changed_at = excluded.source_changed_at,
        attempts = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `)
}

/** The sweep's milestone step: one copy request per (record, milestone, time) in `milestoneRows`. */
export async function queueMilestoneRecordDriveSnapshots(
  db: Db,
  input: {
    readonly recordType: PaperTrailRecordType
    readonly milestone: string
    readonly milestoneRows: SQL
    readonly projectScope: SQL
    readonly stamp: string
  },
): Promise<void> {
  await db.run(sql`
      INSERT INTO project_record_drive_snapshots
        (id, organization_id, project_id, record_type, record_id, milestone, milestone_at, status, requested_at, attempts)
      SELECT lower(hex(randomblob(16))), p.organization_id, m.project_id, ${input.recordType}, m.id, ${input.milestone}, m.at, 'pending', ${input.stamp}, 0
      FROM (${input.milestoneRows}) m
      JOIN projects p ON p.id = m.project_id
      WHERE ${input.projectScope}
      ON CONFLICT DO NOTHING
    `)
}

export async function updateRecordDriveSnapshot(db: Db, id: string, patch: RecordDriveSnapshotPatch): Promise<D1Result> {
  return db.update(projectRecordDriveSnapshots).set(patch).where(eq(projectRecordDriveSnapshots.id, id)).run()
}

export async function updateRecordDriveSnapshotsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: RecordDriveSnapshotPatch,
): Promise<readonly { readonly id: string }[]> {
  return db
    .update(projectRecordDriveSnapshots)
    .set(patch)
    .where(where)
    .returning({ id: projectRecordDriveSnapshots.id })
}

// ---- project_documents

type ProjectDocumentInsert = typeof projectDocuments.$inferInsert
type ProjectDocumentPatch = SQLiteUpdateSetSource<typeof projectDocuments>

export function insertProjectDocumentStatement(db: Db, values: ProjectDocumentInsert): Statement {
  return db.insert(projectDocuments).values(values)
}

/**
 * Inserts many documents in one atomic batch, a few rows per statement so
 * each stays under D1's bound-parameter limit.
 */
export async function insertProjectDocuments(db: Db, rows: readonly ProjectDocumentInsert[]): Promise<void> {
  const [first, ...rest] = chunkD1InsertRows(projectDocuments, rows).map((chunk) => db.insert(projectDocuments).values(chunk))
  if (first) await db.batch([first, ...rest])
}

export function updateProjectDocumentsStatement(db: Db, where: SQL | undefined, patch: ProjectDocumentPatch): Statement {
  return db.update(projectDocuments).set(patch).where(where)
}

export async function updateProjectDocuments(db: Db, where: SQL | undefined, patch: ProjectDocumentPatch): Promise<D1Result> {
  return db.update(projectDocuments).set(patch).where(where).run()
}

export function deleteProjectDocumentsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectDocuments).where(where)
}

// ---- project_archive_documents / project_archive_recipients

type ArchiveDocumentInsert = typeof projectArchiveDocuments.$inferInsert
type ArchiveDocumentPatch = SQLiteUpdateSetSource<typeof projectArchiveDocuments>

/** One batch: a failed recipient cannot leave a partially published edition. */
export async function insertArchiveEdition(
  db: Db,
  archive: ArchiveDocumentInsert & { readonly id: string },
  readerIds: readonly string[],
): Promise<void> {
  await db.batch([
    db.insert(projectArchiveDocuments).values(archive),
    ...readerIds.map((userId) => db.insert(projectArchiveRecipients).values({ archiveId: archive.id, userId })),
  ])
}

export async function updateArchiveDocuments(db: Db, where: SQL | undefined, patch: ArchiveDocumentPatch): Promise<D1Result> {
  return db.update(projectArchiveDocuments).set(patch).where(where).run()
}

// ---- project_links

type ProjectLinkInsert = typeof projectLinks.$inferInsert

/** A link insert for `db.batch` that leaves an existing identical link alone. */
export function insertProjectLinkIfAbsentStatement(db: Db, values: ProjectLinkInsert): Statement {
  return db.insert(projectLinks).values(values).onConflictDoNothing()
}

export async function insertProjectLink(
  db: Db,
  values: ProjectLinkInsert,
  options: { readonly ignoreDuplicate?: boolean } = {},
): Promise<void> {
  if (options.ignoreDuplicate) await db.insert(projectLinks).values(values).onConflictDoNothing()
  else await db.insert(projectLinks).values(values)
}

export async function deleteProjectLink(db: Db, linkId: string): Promise<void> {
  await db.delete(projectLinks).where(eq(projectLinks.id, linkId))
}

// ---- vendor_trade_doc_links

type TradeDocLinkInsert = typeof vendorTradeDocLinks.$inferInsert
type TradeDocLinkPatch = SQLiteUpdateSetSource<typeof vendorTradeDocLinks>

export async function insertTradeDocLink(db: Db, values: TradeDocLinkInsert): Promise<void> {
  await db.insert(vendorTradeDocLinks).values(values)
}

export async function updateTradeDocLink(db: Db, linkId: string, patch: TradeDocLinkPatch): Promise<void> {
  await db.update(vendorTradeDocLinks).set(patch).where(eq(vendorTradeDocLinks.id, linkId))
}

/** Counts one more upload against the link's limit; false once it's used up. */
export async function takeTradeDocLinkUpload(db: Db, linkId: string, limit: number): Promise<boolean> {
  const taken = await db
    .update(vendorTradeDocLinks)
    .set({ uploadCount: sql`${vendorTradeDocLinks.uploadCount} + 1` })
    .where(and(eq(vendorTradeDocLinks.id, linkId), lt(vendorTradeDocLinks.uploadCount, limit)))
    .returning({ id: vendorTradeDocLinks.id })
  return taken.length > 0
}

// ---- vendor_trade_documents

type TradeDocumentInsert = typeof vendorTradeDocuments.$inferInsert
type TradeDocumentPatch = SQLiteUpdateSetSource<typeof vendorTradeDocuments>

export function insertTradeDocumentStatement(db: Db, values: TradeDocumentInsert): Statement {
  return db.insert(vendorTradeDocuments).values(values)
}

export function updateTradeDocumentsStatement(db: Db, where: SQL | undefined, patch: TradeDocumentPatch): Statement {
  return db.update(vendorTradeDocuments).set(patch).where(where)
}

export async function updateTradeDocuments(db: Db, where: SQL | undefined, patch: TradeDocumentPatch): Promise<D1Result> {
  return db.update(vendorTradeDocuments).set(patch).where(where).run()
}

/** Marks a vendor's current document of one type superseded, for a batch that adds its replacement. */
export function supersedeCurrentTradeDocumentStatement(
  db: Db,
  input: { readonly vendorId: string; readonly docType: string; readonly now: string },
): Statement {
  return db
    .update(vendorTradeDocuments)
    .set({ supersededAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(vendorTradeDocuments.vendorId, input.vendorId),
        eq(vendorTradeDocuments.docType, input.docType),
        isNull(vendorTradeDocuments.supersededAt),
      ),
    )
}

export function deleteTradeDocumentStatement(db: Db, documentId: string): Statement {
  return db.delete(vendorTradeDocuments).where(eq(vendorTradeDocuments.id, documentId))
}

// ---- project_source_record_participants

type ParticipantInsert = typeof projectSourceRecordParticipants.$inferInsert
type ParticipantPatch = SQLiteUpdateSetSource<typeof projectSourceRecordParticipants>
/** Awaitable on its own, or one statement in a batch. */
type ParticipantUpsert = SQLiteInsert<typeof projectSourceRecordParticipants, "async", D1Result, undefined>

export function insertSourceRecordParticipantStatement(db: Db, values: ParticipantInsert): Statement {
  return db.insert(projectSourceRecordParticipants).values(values)
}

/** Inserts a participant, or updates `set` on the row with the same source identity. */
export function upsertSourceRecordParticipantStatement(
  db: Db,
  values: ParticipantInsert,
  set: ParticipantPatch,
): ParticipantUpsert {
  return db
    .insert(projectSourceRecordParticipants)
    .values(values)
    .onConflictDoUpdate({
      target: [
        projectSourceRecordParticipants.organizationId,
        projectSourceRecordParticipants.projectId,
        projectSourceRecordParticipants.sourceRecordType,
        projectSourceRecordParticipants.sourceRecordId,
        projectSourceRecordParticipants.sourceParticipantId,
      ],
      set,
    })
    .$dynamic()
}

export function deleteSourceRecordParticipantsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectSourceRecordParticipants).where(where)
}

// ---- contract_packets / contract_packet_documents

type ContractPacketInsert = typeof contractPackets.$inferInsert
type ContractPacketPatch = SQLiteUpdateSetSource<typeof contractPackets>
type ContractPacketDocumentInsert = typeof contractPacketDocuments.$inferInsert
type ContractPacketDocumentPatch = SQLiteUpdateSetSource<typeof contractPacketDocuments>

export function insertContractPacketStatement(db: Db, values: ContractPacketInsert): Statement {
  return db.insert(contractPackets).values(values)
}

export function updateContractPacketStatement(db: Db, packetId: string, patch: ContractPacketPatch): Statement {
  return db.update(contractPackets).set(patch).where(eq(contractPackets.id, packetId))
}

export async function updateContractPacket(db: Db, packetId: string, patch: ContractPacketPatch): Promise<D1Result> {
  return db.update(contractPackets).set(patch).where(eq(contractPackets.id, packetId)).run()
}

/** A project has one executed contract: executing a packet supersedes the others. */
export function supersedeOtherExecutedPacketsStatement(
  db: Db,
  input: { readonly projectId: string; readonly packetId: string; readonly now: string },
): Statement {
  return db
    .update(contractPackets)
    .set({ status: "superseded", updatedAt: input.now })
    .where(
      and(
        eq(contractPackets.projectId, input.projectId),
        eq(contractPackets.status, "executed"),
        ne(contractPackets.id, input.packetId),
      ),
    )
}

export async function deleteContractPacket(db: Db, packetId: string): Promise<D1Result> {
  return db.delete(contractPackets).where(eq(contractPackets.id, packetId)).run()
}

export function insertContractPacketDocumentStatement(db: Db, values: ContractPacketDocumentInsert): Statement {
  return db.insert(contractPacketDocuments).values(values)
}

export async function insertContractPacketDocument(db: Db, values: ContractPacketDocumentInsert): Promise<D1Result> {
  return db.insert(contractPacketDocuments).values(values).run()
}

export async function updateContractPacketDocument(
  db: Db,
  documentId: string,
  patch: ContractPacketDocumentPatch,
): Promise<D1Result> {
  return db.update(contractPacketDocuments).set(patch).where(eq(contractPacketDocuments.id, documentId)).run()
}

export async function deleteContractPacketDocument(db: Db, documentId: string): Promise<D1Result> {
  return db.delete(contractPacketDocuments).where(eq(contractPacketDocuments.id, documentId)).run()
}
