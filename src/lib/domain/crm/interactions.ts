/**
 * Client interactions logged by staff on the Information page or from the
 * map: the form's options, logging one, and soft-deleting one.
 */
import { and, asc, eq, isNull, like } from "drizzle-orm"

import { projectContacts, projectInteractions } from "@/db/schema"
import { clientInteractionRecordProblem } from "@/lib/client-interactions/record-rules"
import { isDemoUser } from "@/lib/demo"
import { insertProjectInteraction, updateProjectInteractions } from "@/lib/domain/crm/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { projectProfileContext } from "@/lib/domain/project/profile-access"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { clearOverdueFollowUpReminders } from "@/lib/notifications/clear-on-read"
import {
  isMeaningfulClientInteraction,
  projectInteractionTypeOptions,
  type ProjectInteractionTypeOption,
} from "@/lib/project-profile"
import { cleanText } from "@/lib/shared/guards"

/** Active client contacts a contact can be logged against, for quick logging from the map. */
export type ProjectInteractionFormOptions = {
  readonly contacts: readonly { readonly id: string; readonly displayName: string }[]
  readonly interactionTypes: readonly ProjectInteractionTypeOption[]
  readonly rules: { readonly minimumSummaryCharacters: number; readonly maximumBackdateDays: number }
}

export async function loadProjectInteractionFormOptions(projectId: string): Promise<ProjectInteractionFormOptions> {
  const { db, organizationId } = await projectProfileContext(projectId, "read")
  const [contacts, customTypes, rules] = await Promise.all([
    db
      .select({ id: projectContacts.id, displayName: projectContacts.displayName })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.displayName)),
    db
      .selectDistinct({ interactionType: projectInteractions.interactionType })
      .from(projectInteractions)
      .where(
        and(
          eq(projectInteractions.organizationId, organizationId),
          eq(projectInteractions.source, "manual"),
          like(projectInteractions.interactionType, "custom:%"),
        ),
      )
      .orderBy(asc(projectInteractions.interactionType)),
    readFeatureSettings(db, organizationId, "client-interactions"),
  ])
  return {
    contacts,
    interactionTypes: projectInteractionTypeOptions(customTypes.map((item) => item.interactionType)),
    rules,
  }
}

export async function logProjectInteraction(input: {
  readonly projectId: string
  readonly interactionType: string
  readonly direction: "inbound" | "outbound"
  readonly summary: string
  readonly occurredAt: string
  readonly contactId: string | null
}): Promise<ProjectProfileResult> {
  const summary = cleanText(input.summary)
  const occurredAt = cleanText(input.occurredAt)
  if (!summary || !occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
    return { success: false, error: "Enter a summary and valid interaction time." }
  }
  const interactionType = cleanText(input.interactionType)
  if (!interactionType) return { success: false, error: "Choose an interaction type." }
  if (!isMeaningfulClientInteraction({
    interactionType,
    direction: input.direction,
    source: "manual",
  })) {
    return { success: false, error: "Choose a valid client interaction type and direction." }
  }
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  if (!input.contactId) return { success: false, error: "Choose an active client contact." }
  // Only a complete record counts as client contact for project aging.
  const recordProblem = clientInteractionRecordProblem(
    { summary, occurredAt },
    await readFeatureSettings(db, organizationId, "client-interactions"),
  )
  if (recordProblem) return { success: false, error: recordProblem }
  const contactRows = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.id, input.contactId),
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.contactType, "owner"),
        eq(projectContacts.active, true),
      ),
    )
    .limit(1)
  if (!contactRows[0]) return { success: false, error: "Choose an active client contact on this project." }
  const timestamp = new Date().toISOString()
  const id = crypto.randomUUID()
  await insertProjectInteraction(db, {
    id,
    organizationId,
    projectId: input.projectId,
    projectContactId: input.contactId,
    interactionType,
    direction: input.direction,
    summary,
    source: "manual",
    qualifiesForClientTouch: true,
    occurredAt: new Date(occurredAt).toISOString(),
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    deletedBy: null,
  })
  await recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "client_interaction_created",
    entityType: "project_interaction",
    entityId: id,
    beforeJson: JSON.stringify(null),
    afterJson: JSON.stringify({ interactionType, direction: input.direction, summary, occurredAt }),
    createdAt: new Date().toISOString(),
  })
  try {
    // Logged contact ends the overdue stretch, so its reminder (and red bell) clears.
    await clearOverdueFollowUpReminders(db, [input.projectId])
  } catch (error) {
    console.error("Unable to clear overdue follow-up reminders", error)
  }
  return { success: true }
}

export async function removeProjectInteraction(input: {
  readonly projectId: string
  readonly interactionId: string
}): Promise<ProjectProfileResult> {
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  const interactionRows = await db
    .select({ summary: projectInteractions.summary, occurredAt: projectInteractions.occurredAt })
    .from(projectInteractions)
    .where(and(eq(projectInteractions.id, input.interactionId), eq(projectInteractions.projectId, input.projectId), isNull(projectInteractions.deletedAt)))
    .limit(1)
  const interaction = interactionRows[0]
  if (!interaction) return { success: false, error: "Interaction not found." }
  const timestamp = new Date().toISOString()
  await updateProjectInteractions(db, eq(projectInteractions.id, input.interactionId), {
    deletedAt: timestamp,
    deletedBy: user.id,
    updatedBy: user.id,
    updatedAt: timestamp,
  })
  await recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "client_interaction_deleted",
    entityType: "project_interaction",
    entityId: input.interactionId,
    beforeJson: JSON.stringify(interaction),
    afterJson: JSON.stringify(null),
    createdAt: new Date().toISOString(),
  })
  return { success: true }
}
