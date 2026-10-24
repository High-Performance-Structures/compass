import { and, eq, inArray, or } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectContacts } from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { canViewRfi } from "@/lib/participant-access"
import type { ProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"

export async function vendorVisibleRfiSourceIds(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly organizationId: string
  readonly viewerId: string
  readonly contact: ProjectAudienceViewerContact | null
}): Promise<readonly string[]> {
  if (!input.contact || !input.viewerId) return []
  // Stable vendor/contact identities establish company involvement. A company
  // name or an audience flag alone never grants another company's RFI.
  const contacts = input.contact.vendorId ? await input.db.select({ id: projectContacts.id }).from(projectContacts)
    .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.vendorId, input.contact.vendorId), eq(projectContacts.active, true))) : [{ id: input.contact.id }]
  const participants = await input.db.select().from(projectSourceRecordParticipants).where(and(
    eq(projectSourceRecordParticipants.projectId, input.projectId),
    eq(projectSourceRecordParticipants.organizationId, input.organizationId),
    eq(projectSourceRecordParticipants.sourceRecordType, "rfi"),
    or(eq(projectSourceRecordParticipants.userId, input.viewerId), inArray(projectSourceRecordParticipants.projectContactId, contacts.map((contact) => contact.id))),
  ))
  return [...new Set(participants.filter(canViewRfi).map((participant) => participant.sourceRecordId))]
}
