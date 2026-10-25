"use client"

import * as React from "react"
import { IconExternalLink, IconVideo, IconVideoPlus } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  cancelProjectClientMeeting,
  scheduleProjectClientMeeting,
  type ProjectClientMeetingItem,
  type ProjectClientMeetingsView,
} from "@/app/actions/project-client-meetings"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { printPreviewHref } from "@/lib/print/print-documents"

const DURATIONS = [15, 30, 45, 60, 90, 120] as const
const MAX_UPCOMING_SHOWN = 3
type When = "now" | "scheduled"

function localDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function nextHalfHour(): Date {
  const date = new Date()
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0)
  return date
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  return minutes === 60 ? "1 hour" : `${minutes / 60} hours`
}

function meetingTimeLabel(meeting: ProjectClientMeetingItem): string {
  const start = new Date(meeting.startsAt)
  const end = new Date(meeting.endsAt)
  const day = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  const time = (value: Date): string =>
    value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return `${day} · ${time(start)}–${time(end)}`
}

function ScheduleMeetingDialog({
  projectId,
  view,
}: {
  readonly projectId: string
  readonly view: ProjectClientMeetingsView
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [when, setWhen] = React.useState<When>("now")
  const [date, setDate] = React.useState("")
  const [time, setTime] = React.useState("")
  const [duration, setDuration] = React.useState("30")
  const [title, setTitle] = React.useState(view.defaultTitle)
  const [guests, setGuests] = React.useState<readonly string[]>([])
  const [staff, setStaff] = React.useState<readonly string[]>([])
  const [note, setNote] = React.useState("")
  const [autoTranscribe, setAutoTranscribe] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function reset(): void {
    const start = nextHalfHour()
    setWhen("now")
    setDate(localDateInput(start))
    setTime(start.toTimeString().slice(0, 5))
    setDuration("30")
    setTitle(view.defaultTitle)
    const recommended = view.guestOptions.find((option) => option.recommended)
    setGuests(recommended ? [recommended.email] : [])
    setStaff([])
    setNote("")
    setAutoTranscribe(true)
    setError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    let startsAt: string | null = null
    if (when === "scheduled") {
      const start = new Date(`${date}T${time}`)
      if (Number.isNaN(start.getTime())) {
        setError("Choose a date and time for the meeting.")
        return
      }
      startsAt = start.toISOString()
    }
    // Open the tab before awaiting so the browser treats it as user-initiated.
    const meetTab = when === "now" ? window.open("", "_blank") : null
    setPending(true)
    setError(null)
    const result = await scheduleProjectClientMeeting(projectId, {
      title,
      note,
      startsAt,
      durationMinutes: Number(duration),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      guestEmails: guests,
      staffEmails: staff,
      autoTranscribe,
    })
    setPending(false)
    if (!result.success) {
      meetTab?.close()
      setError(result.error)
      return
    }
    if (meetTab && result.data.meetingUrl) {
      meetTab.location.href = result.data.meetingUrl
    } else {
      meetTab?.close()
    }
    if (result.data.warning) toast.warning(result.data.warning)
    toast.success(
      when === "now"
        ? "Google Meet started. Your guests have been emailed the link."
        : "Meeting scheduled. Google sent the invitations with the Meet link."
    )
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="w-full" disabled={!view.canSchedule}>
          <IconVideoPlus className="size-4" /> Project Meetings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project meeting</DialogTitle>
            <DialogDescription>
              Compass books a Google Meet on your Google Calendar. Google emails
              each guest the link. Guests don&apos;t need a Compass or Google account.
            </DialogDescription>
          </DialogHeader>
          <ToggleGroup
            type="single"
            variant="outline"
            value={when}
            onValueChange={(value) => {
              if (value === "now" || value === "scheduled") setWhen(value)
            }}
            className="w-full"
          >
            <ToggleGroupItem value="now" className="flex-1">Start now</ToggleGroupItem>
            <ToggleGroupItem value="scheduled" className="flex-1">Schedule</ToggleGroupItem>
          </ToggleGroup>
          <div className="grid gap-3 sm:grid-cols-3">
            {when === "scheduled" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="client-meet-date">Date</Label>
                  <Input id="client-meet-date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-meet-time">Time</Label>
                  <Input id="client-meet-time" type="time" value={time} onChange={(event) => setTime(event.currentTarget.value)} required />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="client-meet-length">Length</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="client-meet-length" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {durationLabel(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-meet-title">Title</Label>
            <Input id="client-meet-title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={200} required />
          </div>
          <EmailRecipientPicker
            id="client-meet-guests"
            label="Clients, vendors and guests"
            options={view.guestOptions}
            value={guests}
            excludedEmails={staff}
            onChange={setGuests}
            placeholder="Choose a contact or enter an email..."
          />
          <EmailRecipientPicker
            id="client-meet-staff"
            label="Staff (optional)"
            options={view.staffOptions}
            value={staff}
            excludedEmails={guests}
            onChange={setStaff}
            placeholder="Add coworkers..."
          />
          <div className="space-y-1.5">
            <Label htmlFor="client-meet-note">Note for the invitation (optional)</Label>
            <Textarea id="client-meet-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={4000} className="min-h-20" />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={autoTranscribe}
              onCheckedChange={(checked) => setAutoTranscribe(checked === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Transcribe automatically</span>
              <span className="block text-xs text-muted-foreground">
                Google tells everyone on the call it is being transcribed. After the call,
                Compass saves the transcript to this project&apos;s Meeting Notes folder and as a draft daily log for review.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            You host the call. The meeting is logged in this project&apos;s Activity.
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || guests.length + staff.length === 0}>
              <IconVideo className="size-4" />
              {pending ? "Booking..." : when === "now" ? "Start Google Meet" : "Schedule and send invites"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelMeetingButton({
  projectId,
  meeting,
}: {
  readonly projectId: string
  readonly meeting: ProjectClientMeetingItem
}): React.ReactElement {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function cancel(): Promise<void> {
    setPending(true)
    const result = await cancelProjectClientMeeting(projectId, meeting.id)
    setPending(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Meeting cancelled. Google let the guests know.")
    router.refresh()
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={pending}>
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this meeting?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{meeting.title}&rdquo; is removed from the host&apos;s Google Calendar
            and Google emails a cancellation to {meeting.guestEmails.join(", ")}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep meeting</AlertDialogCancel>
          <AlertDialogAction onClick={() => void cancel()}>Cancel meeting</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function TranscriptLabel({
  projectId,
  meeting,
}: {
  readonly projectId: string
  readonly meeting: ProjectClientMeetingItem
}): React.ReactElement | null {
  const transcript = meeting.transcript
  if (!transcript) return null
  if (transcript.status === "saved") {
    // Compass's own document preview, with Print / Save PDF.
    const href = printPreviewHref({
      projectId,
      document: "meeting-transcript",
      params: { meetingId: meeting.id },
      number: `Transcript ${meeting.startsAt.slice(0, 10)}`,
    })
    return (
      <>
        {" · "}
        <a href={href} target="_blank" rel="noopener" className="text-primary hover:underline">
          Transcript
        </a>
      </>
    )
  }
  if (transcript.status === "pending") return <> · Transcript pending</>
  if (transcript.status === "none") return <> · No transcript</>
  return <span title={transcript.message}> · Transcript not saved</span>
}

function MoreMeetingsDialog({
  projectId,
  label,
  meetings,
}: {
  readonly projectId: string
  readonly label: string
  readonly meetings: readonly ProjectClientMeetingItem[]
}): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-xs text-primary hover:underline">
          {label} ({meetings.length})
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Transcripts open in Print Preview. Each saved transcript is also a draft daily log.
          </DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {meetings.map((meeting) => (
            <li key={meeting.id} className="py-2 text-xs text-muted-foreground">
              <p className="break-words text-sm text-foreground">{meeting.title}</p>
              <p>
                {meetingTimeLabel(meeting)} · Host {meeting.organizerName}
                {meeting.status === "cancelled" ? " · Cancelled" : ""}
                {meeting.status === "scheduled" && <TranscriptLabel projectId={projectId} meeting={meeting} />}
                {meeting.dailyLogHref ? (
                  <>
                    {" · "}
                    <a href={meeting.dailyLogHref} className="text-primary hover:underline">Daily log</a>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectClientMeetingsCard({
  projectId,
  view,
}: {
  readonly projectId: string
  readonly view: ProjectClientMeetingsView
}): React.ReactElement {
  const [now] = React.useState(() => Date.now())
  const upcoming = view.meetings
    .filter((meeting) => meeting.status === "scheduled" && Date.parse(meeting.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const past = view.meetings.filter((meeting) => !upcoming.includes(meeting))
  // Only the next few calls sit under the button; the rest open in a list.
  const shown = upcoming.slice(0, MAX_UPCOMING_SHOWN)
  const more = [...upcoming.slice(MAX_UPCOMING_SHOWN), ...past]

  return (
    // The button already says Project Meetings, so the section needs no heading.
    <section aria-label="Project meetings" className="mb-5 space-y-3">
      <ScheduleMeetingDialog projectId={projectId} view={view} />
      {upcoming.length > 0 && (
        <ul className="space-y-2">
          {shown.map((meeting) => (
            <li key={meeting.id} className="rounded-md border p-2">
              <p className="truncate text-sm font-medium">{meeting.title}</p>
              <p className="text-xs text-muted-foreground">{meetingTimeLabel(meeting)}</p>
              <p className="truncate text-xs text-muted-foreground">
                Host {meeting.organizerName} · {meeting.guestEmails.join(", ")}
              </p>
              <div className="mt-1.5 flex items-center gap-1">
                {meeting.meetingUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={meeting.meetingUrl} target="_blank" rel="noreferrer">
                      <IconExternalLink className="size-4" /> Join
                    </a>
                  </Button>
                )}
                {meeting.canCancel && <CancelMeetingButton projectId={projectId} meeting={meeting} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {more.length > 0 && (
        <MoreMeetingsDialog
          projectId={projectId}
          label={upcoming.length > shown.length ? "All other meetings" : "Past meetings"}
          meetings={more}
        />
      )}
    </section>
  )
}
