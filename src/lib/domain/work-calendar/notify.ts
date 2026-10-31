import { eventAttendeeNotificationRecipients } from "@/lib/notifications/audience"
import { createNotificationEvent } from "@/lib/notifications/events"
import { projectNumberAndName } from "@/lib/project-display-name"

import { eventHref } from "./rules"
import type { ProjectRow, WorkCalendarEventAttendee } from "./types"

/** Tells attendees an event was created, updated or cancelled. Never throws. */
export async function notifyEventParticipants(input: {
  readonly organizationId: string
  readonly projectId: string | null
  readonly project: ProjectRow | null
  readonly eventId: string
  readonly eventTitle: string
  readonly startLabel: string
  readonly change: "created" | "updated" | "cancelled"
  readonly actorId: string
  readonly actorName: string
  readonly attendees: readonly WorkCalendarEventAttendee[]
}): Promise<void> {
  const recipients = eventAttendeeNotificationRecipients(input.attendees)
  if (recipients.length === 0) return

  const projectName = input.project
    ? input.project.projectNumber
      ? projectNumberAndName(input.project, " — ")
      : input.project.name
    : "an archived project"

  try {
    await createNotificationEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: `schedule.event_${input.change}`,
      sourceType: "calendar_event",
      sourceId: input.eventId,
      title: `${input.eventTitle} ${input.change}`,
      body: `${input.actorName} ${input.change} this event for ${projectName} on ${input.startLabel}.`,
      href: eventHref(input.eventId),
      priority: "normal",
      audience: "attendees",
      createdBy: input.actorId,
      recipients,
      delivery: {
        inApp: true,
        email: false,
        push: true,
      },
    })
  } catch (error) {
    // The event mutation is durable even if a downstream notification
    // provider is temporarily unavailable.
    console.error("Failed to notify calendar event attendees:", error)
  }
}
