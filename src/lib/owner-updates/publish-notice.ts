import "server-only"

import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { projectOwnerPortalUsers } from "@/lib/owner-portal/recipients"

/**
 * A published owner update tells the project's owner portal users (in
 * Compass, on their phones and by email, each per their own Owner updates
 * setting) and lands in the Activity log. Publishing already succeeded, so a
 * notification failure is only logged.
 */
export async function announceOwnerUpdatePublished(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly updateId: string
  readonly title: string
  readonly actor: ActivityActor & { readonly id: string }
}): Promise<void> {
  let notified = 0
  try {
    const project = await input.db
      .select({ name: projects.name, projectNumber: projects.projectNumber })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get()
    const owners = await projectOwnerPortalUsers(input.db, input.organizationId, input.projectId)
    if (project && owners.length > 0) {
      const projectLabel = project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name
      await createNotificationEvent({
        organizationId: input.organizationId,
        projectId: input.projectId,
        eventType: "owner_update.published",
        sourceType: "owner_update",
        sourceId: input.updateId,
        title: `New project update: ${input.title}`,
        body: `A new update for ${projectLabel} is ready to view.`,
        href: `/preview/projects/${encodeURIComponent(input.projectId)}/owner/updates/${encodeURIComponent(input.updateId)}`,
        priority: "normal",
        audience: "owner",
        createdBy: input.actor.id,
        recipients: owners.map((owner) => ({ userId: owner.userId, email: owner.email })),
        delivery: { inApp: true, email: true, push: true },
      })
      notified = owners.length
    }
  } catch (error) {
    console.error("[owner-updates] publish notification failed", error)
  }
  await recordActivityEvent({
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    actor: input.actor,
    category: "field",
    action: "owner_update_published",
    entityType: "owner_project_update",
    entityId: input.updateId,
    summary:
      notified > 0
        ? `Published owner update "${input.title}" and notified ${notified} owner ${notified === 1 ? "user" : "users"}.`
        : `Published owner update "${input.title}". No owner portal users to notify.`,
    metadata: { notified },
  })
}
