import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectContacts } from "@/db/schema"

/**
 * Which schedule items a sub or supplier is responsible for, so their
 * schedule shows them even when nobody marked "Subs can view" (imported jobs
 * arrive with assignments but no marks). A partner is responsible when they
 * are assigned as a person, through their own project contact, or through
 * any project contact for their company (imports assign the company).
 */

type AssigneeRow = {
  readonly scheduleTaskId: string
  readonly participantId: string
  readonly assignedUserId: string | null
  readonly projectContactId: string | null
}

type PublishedTask = {
  readonly id: string
  readonly assignedUserId: string | null
  readonly assigneeParticipantIds: readonly string[]
}

/** The viewer's own project contact plus every contact for their company on this job. */
export async function partnerContactIds(
  db: ReturnType<typeof getDb>,
  projectId: string,
  contact: { readonly id: string; readonly vendorId: string | null } | null,
): Promise<ReadonlySet<string>> {
  if (!contact) return new Set()
  if (!contact.vendorId) return new Set([contact.id])
  const company = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.vendorId, contact.vendorId)))
  return new Set([contact.id, ...company.map((row) => row.id)])
}

/**
 * Item ids the viewer is responsible for. With a publication, the published
 * assignment decides (live assignments only say which participant is theirs),
 * so an unpublished reassignment never shows early.
 */
export function partnerAssignedTaskIds(input: {
  readonly viewerId: string
  readonly contactIds: ReadonlySet<string>
  readonly assignees: readonly AssigneeRow[]
  readonly publishedTasks: readonly PublishedTask[] | null
}): ReadonlySet<string> {
  const mine = input.assignees.filter((row) =>
    (input.viewerId !== "" && row.assignedUserId === input.viewerId) ||
    (row.projectContactId !== null && input.contactIds.has(row.projectContactId)))
  if (!input.publishedTasks) return new Set(mine.map((row) => row.scheduleTaskId))
  const participants = new Set(mine.map((row) => row.participantId))
  return new Set(input.publishedTasks
    .filter((task) =>
      (input.viewerId !== "" && task.assignedUserId === input.viewerId) ||
      task.assigneeParticipantIds.some((id) => participants.has(id)))
    .map((task) => task.id))
}
