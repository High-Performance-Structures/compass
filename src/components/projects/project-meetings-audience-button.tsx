"use client"

import * as React from "react"
import { IconVideo } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { GuestClientMeeting } from "@/lib/client-meetings/guest-meetings"

/** A call can be joined from this long before it starts until it ends. */
const JOIN_EARLY_MS = 10 * 60_000
const CLOCK_TICK_MS = 30_000

function whenLabel(meeting: GuestClientMeeting): string {
  const start = new Date(meeting.startsAt)
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  return `${day} · ${time}`
}

export function joinableMeeting(
  meetings: readonly GuestClientMeeting[],
  now: number
): GuestClientMeeting | null {
  return (
    meetings
      .filter((meeting) => Date.parse(meeting.startsAt) - JOIN_EARLY_MS <= now && now < Date.parse(meeting.endsAt))
      .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
  )
}

/**
 * The owner and vendor counterpart of the staff Project Meetings button. It
 * reads Join meeting while a call they were invited to is open, and otherwise
 * lists their upcoming calls.
 */
export function ProjectMeetingsAudienceButton({
  meetings,
}: {
  readonly meetings: readonly GuestClientMeeting[]
}): React.ReactElement {
  // Read the clock after hydration so server and browser render the same label.
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const live = now === null ? null : joinableMeeting(meetings, now)
  const upcoming = meetings
    .filter((meeting) => now === null || Date.parse(meeting.endsAt) > now)
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))

  if (live) {
    return (
      <Button asChild size="sm">
        <a href={live.meetingUrl} target="_blank" rel="noreferrer" title={`${live.title} · Hosted by ${live.hostName}`}>
          <IconVideo className="size-4" /> Join meeting
        </a>
      </Button>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm">
          <IconVideo className="size-4" /> Project Meetings
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium">Upcoming meetings</p>
        {upcoming.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            None scheduled. When your project team invites you to a Google Meet, it appears here and this button
            turns into Join meeting when the call opens.
          </p>
        ) : (
          <ul className="mt-2 max-h-72 divide-y overflow-y-auto">
            {upcoming.map((meeting) => (
              <li key={meeting.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm" title={meeting.title}>{meeting.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {whenLabel(meeting)} · {meeting.hostName}
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <a href={meeting.meetingUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
