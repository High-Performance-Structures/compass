import { IconVideo } from "@tabler/icons-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import type { GuestClientMeeting } from "@/lib/client-meetings/guest-meetings"

function whenLabel(meeting: GuestClientMeeting): string {
  const start = new Date(meeting.startsAt)
  const day = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  return `${day} at ${time}`
}

/**
 * Join links for the Google Meets a client or vendor was invited to, shown on
 * their project workspace. Renders nothing when there are none.
 */
export function ClientMeetingJoinBanner({
  meetings,
}: {
  readonly meetings: readonly GuestClientMeeting[]
}): React.ReactElement | null {
  if (meetings.length === 0) return null
  return (
    <section aria-label="Upcoming meetings" className="space-y-2">
      {meetings.map((meeting) => (
        <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{meeting.title}</p>
            <p className="text-xs text-muted-foreground">
              {whenLabel(meeting)} · Hosted by {meeting.hostName}
            </p>
          </div>
          <Button asChild size="sm">
            <a href={meeting.meetingUrl} target="_blank" rel="noreferrer">
              <IconVideo className="size-4" /> Join meeting
            </a>
          </Button>
        </div>
      ))}
    </section>
  )
}
