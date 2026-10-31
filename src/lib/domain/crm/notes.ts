/** Project notes on the Information page: add and soft-delete, each audited. */
import { and, eq, isNull } from "drizzle-orm"

import { projectNotes } from "@/db/schema"
import { isDemoUser } from "@/lib/demo"
import { insertProjectNote, updateProjectNotes } from "@/lib/domain/crm/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { projectProfileContext } from "@/lib/domain/project/profile-access"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import { cleanText } from "@/lib/shared/guards"

export async function addProjectNote(input: {
  readonly projectId: string
  readonly body: string
}): Promise<ProjectProfileResult> {
  const body = cleanText(input.body)
  if (!body) return { success: false, error: "Enter a note." }
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  const timestamp = new Date().toISOString()
  const id = crypto.randomUUID()
  await insertProjectNote(db, {
    id,
    organizationId,
    projectId: input.projectId,
    content: body,
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
    eventType: "project_note_created",
    entityType: "project_note",
    entityId: id,
    beforeJson: JSON.stringify(null),
    afterJson: JSON.stringify({ body }),
    createdAt: new Date().toISOString(),
  })
  return { success: true }
}

export async function removeProjectNote(input: {
  readonly projectId: string
  readonly noteId: string
}): Promise<ProjectProfileResult> {
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  const noteRows = await db
    .select({ content: projectNotes.content })
    .from(projectNotes)
    .where(and(eq(projectNotes.id, input.noteId), eq(projectNotes.projectId, input.projectId), isNull(projectNotes.deletedAt)))
    .limit(1)
  const note = noteRows[0]
  if (!note) return { success: false, error: "Note not found." }
  const timestamp = new Date().toISOString()
  await updateProjectNotes(db, eq(projectNotes.id, input.noteId), {
    deletedAt: timestamp,
    deletedBy: user.id,
    updatedBy: user.id,
    updatedAt: timestamp,
  })
  await recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "project_note_deleted",
    entityType: "project_note",
    entityId: input.noteId,
    beforeJson: JSON.stringify(note),
    afterJson: JSON.stringify(null),
    createdAt: new Date().toISOString(),
  })
  return { success: true }
}
