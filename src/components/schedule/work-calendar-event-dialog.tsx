"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCalendarPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  cancelWorkCalendarEvent,
  createWorkCalendarEvent,
  updateWorkCalendarEvent,
  type ProjectRow,
  type WorkCalendarEntry,
  type WorkCalendarEventAttendee,
} from "@/app/actions/work-calendar"
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
import {
  instantForLocalDateTime,
  isWorkCalendarEventType,
  isWorkCalendarEventVisibility,
  type WorkCalendarEventType,
  type WorkCalendarEventVisibility,
} from "@/lib/work-calendar"

const DEFAULT_PROJECT_VALUE = "__h_office_default__"

type CalendarEventEntry = Extract<WorkCalendarEntry, { kind: "event" }>

type CommonProps = {
  readonly projects: readonly ProjectRow[]
  readonly attendeeOptions: readonly WorkCalendarEventAttendee[]
  readonly defaultProjectId: string | null
  readonly defaultTimeZone: string
  readonly today: string
}

type WorkCalendarEventDialogProps = CommonProps &
  (
    | {
        readonly variant: "create"
      }
    | {
        readonly variant: "edit"
        readonly event: CalendarEventEntry
        readonly open: boolean
        readonly onOpenChange: (open: boolean) => void
      }
  )

type EventFormSeed = {
  readonly title: string
  readonly eventType: WorkCalendarEventType
  readonly visibility: WorkCalendarEventVisibility
  readonly description: string
  readonly projectValue: string
  readonly allDay: boolean
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
  readonly timeZone: string
  readonly location: string
  readonly meetingUrl: string
  readonly attendeeUserIds: readonly string[]
}

function projectLabel(project: ProjectRow): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

function formSeed(
  props: WorkCalendarEventDialogProps
): EventFormSeed {
  if (props.variant === "edit") {
    const details = props.event.eventDetails
    return {
      title: props.event.title,
      eventType: details.eventType,
      visibility: details.visibility,
      description: details.description ?? "",
      projectValue:
        props.event.projectId ??
        (props.defaultProjectId ? DEFAULT_PROJECT_VALUE : ""),
      allDay: details.allDay,
      startDate: details.startDate,
      endDate: details.endDate,
      startTime: details.startTime || "09:00",
      endTime: details.endTime || "10:00",
      timeZone: details.timeZone,
      location: details.location ?? "",
      meetingUrl: details.meetingUrl ?? "",
      attendeeUserIds: details.attendees.map(
        (attendee) => attendee.userId
      ),
    }
  }

  return {
    title: "",
    eventType: "meeting",
    visibility: "organization",
    description: "",
    projectValue: props.defaultProjectId
      ? DEFAULT_PROJECT_VALUE
      : "",
    allDay: false,
    startDate: props.today,
    endDate: props.today,
    startTime: "09:00",
    endTime: "10:00",
    timeZone: props.defaultTimeZone,
    location: "",
    meetingUrl: "",
    attendeeUserIds: [],
  }
}

export function WorkCalendarEventDialog(
  props: WorkCalendarEventDialogProps
): React.ReactElement {
  const router = useRouter()
  const seed = formSeed(props)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [title, setTitle] = React.useState(seed.title)
  const [eventType, setEventType] = React.useState(seed.eventType)
  const [visibility, setVisibility] = React.useState(seed.visibility)
  const [description, setDescription] = React.useState(seed.description)
  const [projectValue, setProjectValue] = React.useState(seed.projectValue)
  const [allDay, setAllDay] = React.useState(seed.allDay)
  const [startDate, setStartDate] = React.useState(seed.startDate)
  const [endDate, setEndDate] = React.useState(seed.endDate)
  const [startTime, setStartTime] = React.useState(seed.startTime)
  const [endTime, setEndTime] = React.useState(seed.endTime)
  const [timeZone, setTimeZone] = React.useState(seed.timeZone)
  const [location, setLocation] = React.useState(seed.location)
  const [meetingUrl, setMeetingUrl] = React.useState(seed.meetingUrl)
  const [attendeeUserIds, setAttendeeUserIds] = React.useState<
    readonly string[]
  >(seed.attendeeUserIds)

  const open = props.variant === "create" ? createOpen : props.open

  function reset(): void {
    const next = formSeed(props)
    setTitle(next.title)
    setEventType(next.eventType)
    setVisibility(next.visibility)
    setDescription(next.description)
    setProjectValue(next.projectValue)
    setAllDay(next.allDay)
    setStartDate(next.startDate)
    setEndDate(next.endDate)
    setStartTime(next.startTime)
    setEndTime(next.endTime)
    setTimeZone(next.timeZone)
    setLocation(next.location)
    setMeetingUrl(next.meetingUrl)
    setAttendeeUserIds(next.attendeeUserIds)
  }

  function changeOpen(nextOpen: boolean): void {
    if (props.variant === "create") {
      setCreateOpen(nextOpen)
    } else {
      props.onOpenChange(nextOpen)
    }
    if (!nextOpen) reset()
  }

  function toggleAttendee(userId: string, checked: boolean): void {
    setAttendeeUserIds((current) =>
      checked
        ? Array.from(new Set([...current, userId]))
        : current.filter((candidate) => candidate !== userId)
    )
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const projectId =
      projectValue === DEFAULT_PROJECT_VALUE ? null : projectValue || null
    const startResolution = allDay
      ? null
      : instantForLocalDateTime(startDate, startTime, timeZone)
    const endResolution = allDay
      ? null
      : instantForLocalDateTime(endDate, endTime, timeZone)
    if (startResolution && !startResolution.success) {
      toast.error(`Start time: ${startResolution.error}`)
      return
    }
    if (endResolution && !endResolution.success) {
      toast.error(`End time: ${endResolution.error}`)
      return
    }
    if (startResolution?.ambiguous || endResolution?.ambiguous) {
      toast.info(
        "This time occurs twice at daylight-saving time; Compass will use the first occurrence."
      )
    }
    const input = {
      title,
      eventType,
      visibility,
      description: description || null,
      projectId,
      allDay,
      startDate,
      endDate,
      startTime,
      endTime,
      startsAt: startResolution?.instant ?? null,
      endsAt: endResolution?.instant ?? null,
      timeZone,
      location: location || null,
      meetingUrl: meetingUrl || null,
      attendeeUserIds,
    }

    startTransition(async () => {
      const result =
        props.variant === "create"
          ? await createWorkCalendarEvent(input)
          : await updateWorkCalendarEvent(
              props.event.id,
              props.event.eventDetails.version,
              input
            )

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(
        props.variant === "create"
          ? "Event added to the work calendar."
          : "Event updated."
      )
      changeOpen(false)
      router.refresh()
    })
  }

  function cancelEvent(): void {
    if (props.variant !== "edit") return
    startTransition(async () => {
      const result = await cancelWorkCalendarEvent(
        props.event.id,
        props.event.eventDetails.version
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Event cancelled.")
      changeOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {props.variant === "create" && (
        <DialogTrigger asChild>
          <Button type="button" size="sm">
            <IconCalendarPlus className="size-4" />
            Add event
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {props.variant === "create"
                ? "Add work calendar event"
                : "Edit work calendar event"}
            </DialogTitle>
            <DialogDescription>
              Add a meeting or ordinary event. A blank project files it under
              the one configured H-Office project.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <Label htmlFor={`work-calendar-event-title-${props.variant}`}>
                Title
              </Label>
              <Input
                id={`work-calendar-event-title-${props.variant}`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Weekly operations meeting"
                maxLength={200}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`work-calendar-event-type-${props.variant}`}>
                  Event type
                </Label>
                <Select
                  value={eventType}
                  onValueChange={(value) => {
                    if (isWorkCalendarEventType(value)) setEventType(value)
                  }}
                >
                  <SelectTrigger
                    id={`work-calendar-event-type-${props.variant}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="appointment">Appointment</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                    <SelectItem value="delivery">Delivery</SelectItem>
                    <SelectItem value="company_event">
                      Company event
                    </SelectItem>
                    <SelectItem value="absence">Absence / time off</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label
                  htmlFor={`work-calendar-event-visibility-${props.variant}`}
                >
                  Visibility
                </Label>
                <Select
                  value={visibility}
                  onValueChange={(value) => {
                    if (isWorkCalendarEventVisibility(value)) {
                      setVisibility(value)
                    }
                  }}
                >
                  <SelectTrigger
                    id={`work-calendar-event-visibility-${props.variant}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="organization">
                      Company details
                    </SelectItem>
                    <SelectItem value="participants">
                      Participants only
                    </SelectItem>
                    <SelectItem value="busy">Busy to others</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`work-calendar-event-project-${props.variant}`}>
                Project
              </Label>
              <Select value={projectValue} onValueChange={setProjectValue}>
                <SelectTrigger
                  id={`work-calendar-event-project-${props.variant}`}
                >
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {props.defaultProjectId && (
                    <SelectItem value={DEFAULT_PROJECT_VALUE}>
                      H-Office (default)
                    </SelectItem>
                  )}
                  {props.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {projectLabel(project)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!props.defaultProjectId && (
                <p className="text-xs text-muted-foreground">
                  Compass could not identify one unique H-Office project, so a
                  project is required.
                </p>
              )}
            </div>

            <label className="flex items-center gap-3 border-y py-3 text-sm font-medium">
              <Checkbox
                checked={allDay}
                onCheckedChange={(checked) => setAllDay(checked === true)}
              />
              All-day event
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`work-calendar-event-start-${props.variant}`}>
                  Starts
                </Label>
                <Input
                  id={`work-calendar-event-start-${props.variant}`}
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value)
                    if (endDate < event.target.value) {
                      setEndDate(event.target.value)
                    }
                  }}
                  required
                />
                {!allDay && (
                  <Input
                    aria-label="Start time"
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    required
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`work-calendar-event-end-${props.variant}`}>
                  Ends
                </Label>
                <Input
                  id={`work-calendar-event-end-${props.variant}`}
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                />
                {!allDay && (
                  <Input
                    aria-label="End time"
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    required
                  />
                )}
              </div>
            </div>
            {!allDay && (
              <p className="text-xs text-muted-foreground">
                Time zone: {timeZone}
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor={`work-calendar-event-location-${props.variant}`}>
                Location
              </Label>
              <Input
                id={`work-calendar-event-location-${props.variant}`}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Office, job site, or video link"
                maxLength={500}
              />
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor={`work-calendar-event-meeting-link-${props.variant}`}
              >
                Meeting link
              </Label>
              <Input
                id={`work-calendar-event-meeting-link-${props.variant}`}
                type="url"
                value={meetingUrl}
                onChange={(event) => setMeetingUrl(event.target.value)}
                placeholder="https://meet.google.com/..."
                maxLength={2_000}
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Attendees</legend>
              {props.attendeeOptions.length > 0 ? (
                <div className="max-h-40 overflow-y-auto border-y py-1">
                  {props.attendeeOptions.map((attendee) => (
                    <label
                      key={attendee.userId}
                      className="flex items-start gap-3 px-1 py-2 text-sm"
                    >
                      <Checkbox
                        checked={attendeeUserIds.includes(attendee.userId)}
                        onCheckedChange={(checked) =>
                          toggleAttendee(
                            attendee.userId,
                            checked === true
                          )
                        }
                      />
                      <span>
                        <span className="block font-medium">
                          {attendee.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {attendee.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No active organization members are available.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Attendees receive a Compass notification when the event is
                created, changed, or cancelled.
              </p>
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor={`work-calendar-event-notes-${props.variant}`}>
                Description
              </Label>
              <Textarea
                id={`work-calendar-event-notes-${props.variant}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional agenda or details"
                maxLength={5_000}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {props.variant === "edit" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={pending}
                    >
                      <IconTrash className="size-4" />
                      Cancel event
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel this event?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The event will leave the active calendar and its
                        attendees will be notified.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel type="button">
                        Keep event
                      </AlertDialogCancel>
                      <AlertDialogAction
                        type="button"
                        onClick={cancelEvent}
                      >
                        Cancel event
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => changeOpen(false)}
                disabled={pending}
              >
                Close
              </Button>
              <Button
                type="submit"
                disabled={
                  pending ||
                  title.trim().length === 0 ||
                  startDate.length === 0 ||
                  endDate.length === 0 ||
                  (!allDay &&
                    (startTime.length === 0 || endTime.length === 0)) ||
                  (!props.defaultProjectId && projectValue.length === 0)
                }
              >
                {props.variant === "edit" && (
                  <IconPencil className="size-4" />
                )}
                {pending
                  ? "Saving…"
                  : props.variant === "create"
                    ? "Add event"
                    : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
