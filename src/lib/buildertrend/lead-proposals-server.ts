import { and, desc, eq, inArray } from "drizzle-orm"

import { buildertrendArchiveFiles, buildertrendSourceRecords } from "@/db/schema-buildertrend"
import type { AuthUser } from "@/lib/auth"
import {
  BT_LEAD_PROPOSAL_RECORD_TYPE,
  btProposalAttachment,
  btProposalGroupViews,
  btProposalStatusLabel,
  parseBtLeadProposal,
  type BtLeadProposal,
  type BtProposalAttachment,
  type BtProposalGroupView,
  type BtProposalStatus,
} from "@/lib/buildertrend/lead-proposal"
import { chunkD1Values } from "@/lib/d1-query"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { assertProjectAccess } from "@/lib/domain/project/access"
import { requireUserContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Buildertrend lead proposals on a project's Estimate page: read-only,
 * staff-only history (never an owner or vendor portal). The guard here is
 * shared by the server actions and the Print Preview page; the loaders read
 * buildertrend_staging_records rows of type 'lead_proposal_detail' and their
 * captured files, scoped in SQL to the organization and project.
 */

/** The estimate page's feature permission: "read" to see, "update" to copy. */
const ESTIMATE_FEATURE = "budget"

export type BtProposalStaffContext = {
  readonly user: AuthUser
  readonly db: Db
  readonly organizationId: string
}

/**
 * Active internal staff (not the demo account) with the estimate permission
 * and access to the project. Throws with a message the caller returns.
 */
export async function btProposalStaffContext(projectId: string, purpose: "read" | "copy"): Promise<BtProposalStaffContext> {
  const { user, db } = await requireUserContext({
    feature: ESTIMATE_FEATURE,
    action: purpose === "copy" ? "update" : "read",
    mutation: purpose === "copy",
  })
  if (!user.isActive || isDemoUser(user.id) || user.organizationType !== "internal" || !isInternalStaffRole(user.role)) {
    throw new Error("Buildertrend proposals are available only to authorized internal staff.")
  }
  const organizationId = requireOrg(user)
  const project = await assertProjectAccess(db, user, projectId)
  if (project.organizationId !== organizationId) throw new Error("Project not found")
  return { user, db, organizationId }
}

export type BtProposalView = {
  /** The staging record id: what the drawer, copy and print use. */
  readonly id: string
  readonly proposalId: string
  readonly title: string
  readonly status: BtProposalStatus
  readonly statusLabel: string
  readonly statusText: string
  readonly statusDate: string | null
  /** The list date: the record date, else when the proposal was added. */
  readonly date: string | null
  readonly approvedByName: string | null
  readonly signedInBuildertrend: boolean
  readonly approvalComments: string | null
  readonly approvalDeadline: string | null
  readonly addedByName: string | null
  readonly addedAt: string | null
  readonly updatedByName: string | null
  readonly updatedAt: string | null
  readonly ownerName: string | null
  readonly address: string | null
  readonly introText: string | null
  readonly closingText: string | null
  readonly ownerTotalCents: number
  readonly builderCostTotalCents: number
  readonly groups: readonly BtProposalGroupView[]
  readonly attachments: readonly BtProposalAttachment[]
}

export type BtProposalList = {
  readonly proposals: readonly BtProposalView[]
  /** Rows whose payload failed validation: skipped, not shown. */
  readonly skipped: number
}

type RecordRow = {
  readonly id: string
  readonly recordDate: string | null
  readonly rawPayloadJson: string | null
}

function proposalView(row: RecordRow, proposal: BtLeadProposal, attachments: readonly BtProposalAttachment[]): BtProposalView {
  return {
    id: row.id,
    proposalId: proposal.proposalId,
    title: proposal.title,
    status: proposal.status,
    statusLabel: btProposalStatusLabel(proposal),
    statusText: proposal.statusText,
    statusDate: proposal.statusDate,
    date: row.recordDate ?? proposal.addedAt ?? proposal.statusDate,
    approvedByName: proposal.approvedByName,
    signedInBuildertrend: proposal.signedInBuildertrend,
    approvalComments: proposal.approvalComments,
    approvalDeadline: proposal.approvalDeadline,
    addedByName: proposal.addedByName,
    addedAt: proposal.addedAt,
    updatedByName: proposal.updatedByName,
    updatedAt: proposal.updatedAt,
    ownerName: proposal.ownerName,
    address: proposal.address,
    introText: proposal.introText,
    closingText: proposal.closingText,
    ownerTotalCents: proposal.ownerTotalCents,
    builderCostTotalCents: proposal.builderCostTotalCents,
    groups: btProposalGroupViews(proposal.groups),
    attachments,
  }
}

const recordColumns = {
  id: buildertrendSourceRecords.id,
  recordDate: buildertrendSourceRecords.recordDate,
  rawPayloadJson: buildertrendSourceRecords.rawPayloadJson,
}

function projectProposalsWhere(organizationId: string, projectId: string): ReturnType<typeof and> {
  return and(
    eq(buildertrendSourceRecords.organizationId, organizationId),
    eq(buildertrendSourceRecords.projectId, projectId),
    eq(buildertrendSourceRecords.sourceRecordType, BT_LEAD_PROPOSAL_RECORD_TYPE),
  )
}

async function loadViews(
  context: BtProposalStaffContext,
  projectId: string,
  rows: readonly RecordRow[],
): Promise<BtProposalList> {
  const parsed = rows.flatMap((row) => {
    const result = parseBtLeadProposal(row.rawPayloadJson)
    return result.success ? [{ row, proposal: result.proposal }] : []
  })
  const ids = parsed.map((entry) => entry.row.id)
  const files = buildertrendArchiveFiles
  const fileRows = (
    await Promise.all(
      chunkD1Values(ids).map((chunk) =>
        context.db
          .select({
            id: files.id,
            sourceRecordId: files.sourceRecordId,
            fileName: files.fileName,
            verifiedDriveFileId: files.verifiedDriveFileId,
            verifiedDriveUrl: files.verifiedDriveUrl,
          })
          .from(files)
          .where(and(
            eq(files.organizationId, context.organizationId),
            eq(files.projectId, projectId),
            eq(files.sourceRecordType, BT_LEAD_PROPOSAL_RECORD_TYPE),
            inArray(files.sourceRecordId, chunk),
          ))
          .orderBy(files.fileName),
      ),
    )
  ).flat()
  const proposals = parsed.map(({ row, proposal }) =>
    proposalView(row, proposal, fileRows.filter((file) => file.sourceRecordId === row.id).map(btProposalAttachment)),
  )
  return { proposals, skipped: rows.length - parsed.length }
}

/** The project's proposals, newest first. */
export async function loadProjectBtProposals(context: BtProposalStaffContext, projectId: string): Promise<BtProposalList> {
  const rows = await context.db
    .select(recordColumns)
    .from(buildertrendSourceRecords)
    .where(projectProposalsWhere(context.organizationId, projectId))
    .orderBy(desc(buildertrendSourceRecords.recordDate), desc(buildertrendSourceRecords.id))
  return loadViews(context, projectId, rows)
}

/** One proposal on the project, or null when it is missing or its payload is invalid. */
export async function loadProjectBtProposal(
  context: BtProposalStaffContext,
  projectId: string,
  recordId: string,
): Promise<{ readonly view: BtProposalView; readonly proposal: BtLeadProposal } | null> {
  const row = await context.db
    .select(recordColumns)
    .from(buildertrendSourceRecords)
    .where(and(projectProposalsWhere(context.organizationId, projectId), eq(buildertrendSourceRecords.id, recordId)))
    .get()
  if (!row) return null
  const parsed = parseBtLeadProposal(row.rawPayloadJson)
  if (!parsed.success) return null
  const { proposals } = await loadViews(context, projectId, [row])
  const view = proposals[0]
  return view ? { view, proposal: parsed.proposal } : null
}
