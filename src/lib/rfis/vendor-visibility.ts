import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import type { getDb } from "@/db"
import { projectContacts, projectRfis } from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { canViewRfi } from "@/lib/participant-access"
import type { ProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { RFI_REQUESTER_ROLE, RFI_VENDOR_ASSIGNEE_ROLE, VENDOR_ASSIGNEE_PARTICIPANT_ID } from "@/lib/rfis/vendor-assignment"

/**
 * Vendor RFI rule: a vendor sees an RFI when it is assigned to their company
 * (every active contact sharing the assigned contact's vendor record), plus
 * RFIs they submitted themselves. The audience flag, a company label, or any
 * other participant role never grants another company's RFI.
 */
export async function vendorVisibleRfiSourceIds(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly organizationId: string
  readonly viewerId: string
  readonly contact: ProjectAudienceViewerContact | null
}): Promise<readonly string[]> {
  if (!input.viewerId) return []
  const viewerContactId = input.contact?.id ?? null
  // A contact without a stable vendor record only matches itself; a shared
  // display or company name is never treated as the same company.
  const companyContactIds = new Set<string>(viewerContactId ? [viewerContactId] : [])
  if (input.contact?.vendorId) {
    const coworkers = await input.db.select({ id: projectContacts.id }).from(projectContacts)
      .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.vendorId, input.contact.vendorId), eq(projectContacts.active, true)))
    for (const coworker of coworkers) companyContactIds.add(coworker.id)
  }
  // Filter in memory so a large company or RFI log never exceeds D1's
  // bound-parameter limit; the row count is bounded by the project's RFIs.
  const participants = await input.db.select().from(projectSourceRecordParticipants).where(and(
    eq(projectSourceRecordParticipants.projectId, input.projectId),
    eq(projectSourceRecordParticipants.organizationId, input.organizationId),
    eq(projectSourceRecordParticipants.sourceRecordType, "rfi"),
    inArray(projectSourceRecordParticipants.participantRole, [RFI_VENDOR_ASSIGNEE_ROLE, RFI_REQUESTER_ROLE]),
  ))
  const rfis = await input.db.select({ id: projectRfis.id, sourceRecordId: projectRfis.sourceRecordId }).from(projectRfis).where(eq(projectRfis.projectId, input.projectId))
  const canonicalIds = new Map<string, string>()
  for (const rfi of rfis) {
    canonicalIds.set(rfi.id, rfi.id)
    if (rfi.sourceRecordId) canonicalIds.set(rfi.sourceRecordId, rfi.id)
  }
  const canonicalId = (id: string): string => canonicalIds.get(id) ?? id
  // A deliberate staff assignment (including a cleared tombstone) replaces
  // imported assignees; old source grants cannot resurrect a removed company.
  const managed = new Set(participants.filter((row) => row.sourceParticipantId === VENDOR_ASSIGNEE_PARTICIPANT_ID).map((row) => canonicalId(row.sourceRecordId)))
  const visible = participants.filter((participant) => {
    if (!canViewRfi(participant)) return false
    if (participant.participantRole === RFI_VENDOR_ASSIGNEE_ROLE) {
      if (managed.has(canonicalId(participant.sourceRecordId)) && participant.sourceParticipantId !== VENDOR_ASSIGNEE_PARTICIPANT_ID) return false
      return participant.projectContactId !== null && companyContactIds.has(participant.projectContactId)
    }
    // The submitter keeps their own RFI; coworkers need a company assignment.
    return participant.userId !== null ? participant.userId === input.viewerId : viewerContactId !== null && participant.projectContactId === viewerContactId
  })
  return [...new Set(visible.map((participant) => canonicalId(participant.sourceRecordId)))]
}

/** `column IN (ids)` bound as one JSON parameter, so any list size is D1-safe. */
export function inJsonList(column: AnySQLiteColumn, ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`0` : sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
}
