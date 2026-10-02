import { and, eq, isNotNull } from "drizzle-orm"
import type { getDb } from "@/db"
import { correspondenceMessages, correspondenceParticipants, correspondenceRecipients } from "@/db/schema-correspondence"
import { projectEmailCampaigns, projectEmailRecipients } from "@/db/schema-project-email"
import type { CorrespondencePerson } from "@/lib/correspondence/types"

export type ProjectEmailPrivacy = {
  readonly senderUserId: string
  readonly blindUserIds: ReadonlySet<string>
  readonly blindUserIdsByEmail: ReadonlyMap<string, string>
}

export async function projectEmailPrivacy(db: ReturnType<typeof getDb>, organizationId: string, projectId: string, conversationId: string): Promise<ProjectEmailPrivacy | null> {
  const original = await db.select({ id: correspondenceMessages.id }).from(correspondenceMessages).where(and(eq(correspondenceMessages.conversationId, conversationId), eq(correspondenceMessages.source, "email"), isNotNull(correspondenceMessages.authorUserId))).get()
  if (!original) return null
  const campaign = await db.select().from(projectEmailCampaigns).where(and(eq(projectEmailCampaigns.conversationId, conversationId), eq(projectEmailCampaigns.organizationId, organizationId), eq(projectEmailCampaigns.projectId, projectId))).get()
  if (!campaign) return null
  const addresses = await db.select().from(projectEmailRecipients).where(and(eq(projectEmailRecipients.campaignId, campaign.id), eq(projectEmailRecipients.kind, "bcc")))
  // Match saved participant addresses and original grants, so changing an account
  // email later cannot reveal a blind recipient or add a new private audience.
  const people = await db.select({ userId: correspondenceParticipants.userId, email: correspondenceParticipants.email }).from(correspondenceParticipants)
    .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.userId, correspondenceParticipants.userId), eq(correspondenceRecipients.messageId, campaign.messageId)))
    .where(eq(correspondenceParticipants.conversationId, conversationId))
  const blindAddresses = new Set(addresses.map((address) => address.email))
  const blindPeople = people.filter((person) => person.userId !== campaign.senderUserId && blindAddresses.has(person.email.trim().toLowerCase()))
  return { senderUserId: campaign.senderUserId, blindUserIds: new Set(blindPeople.map((person) => person.userId)), blindUserIdsByEmail: new Map(blindPeople.map((person) => [person.email.trim().toLowerCase(), person.userId])) }
}

export function visibleProjectEmailPeople<T extends CorrespondencePerson>(people: readonly T[], privacy: ProjectEmailPrivacy | null, viewerId: string): readonly T[] {
  if (!privacy || privacy.senderUserId === viewerId) return people
  const blindViewer = privacy.blindUserIds.has(viewerId)
  return people.filter((person) => person.userId === viewerId || !privacy.blindUserIds.has(person.userId) && (!blindViewer || person.role === "staff"))
}

export function privateProjectEmailReplyPeople<T extends CorrespondencePerson>(people: readonly T[], privacy: ProjectEmailPrivacy | null, blindSenderId: string | null): readonly T[] {
  if (!privacy || !blindSenderId) return people
  return people.filter((person) => person.userId === blindSenderId || person.role === "staff" && !privacy.blindUserIds.has(person.userId))
}
