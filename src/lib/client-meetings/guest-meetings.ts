import { and, eq, gt } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectClientMeetings, users } from "@/db/schema"
import { normalizeRecipientEmail } from "@/lib/email/recipient-options"

export type GuestClientMeeting = {
  readonly id: string
  readonly title: string
  readonly startsAt: string
  readonly endsAt: string
  readonly meetingUrl: string
  readonly hostName: string
}

function emailList(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/**
 * Upcoming client meetings on a project that one of these addresses was
 * invited to as a guest. Callers resolve whose workspace is being shown and
 * have already checked that person's access to the project.
 */
export async function upcomingClientMeetingsForGuest(
  db: ReturnType<typeof getDb>,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly emails: readonly (string | null | undefined)[]
    readonly now?: Date
  }
): Promise<readonly GuestClientMeeting[]> {
  const emails = new Set(
    input.emails.flatMap((email) => (email ? [normalizeRecipientEmail(email)] : []))
  )
  if (emails.size === 0) return []
  const now = (input.now ?? new Date()).toISOString()
  const rows = await db
    .select({
      meeting: projectClientMeetings,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(projectClientMeetings)
    .innerJoin(users, eq(users.id, projectClientMeetings.organizerUserId))
    .where(
      and(
        eq(projectClientMeetings.organizationId, input.organizationId),
        eq(projectClientMeetings.projectId, input.projectId),
        eq(projectClientMeetings.status, "scheduled"),
        gt(projectClientMeetings.endsAt, now)
      )
    )
  return rows
    .filter(({ meeting }) => emailList(meeting.guestEmails).some((email) => emails.has(email)))
    .flatMap(({ meeting, ...host }) =>
      meeting.meetingUrl
        ? [
            {
              id: meeting.id,
              title: meeting.title,
              startsAt: meeting.startsAt,
              endsAt: meeting.endsAt,
              meetingUrl: meeting.meetingUrl,
              hostName:
                host.displayName?.trim() ||
                [host.firstName, host.lastName].filter(Boolean).join(" ").trim() ||
                host.email,
            },
          ]
        : []
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
