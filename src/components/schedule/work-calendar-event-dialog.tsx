"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCalendarPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createWorkCalendarEvent,
  type ProjectRow,
} from "@/app/actions/work-calendar"
import { Button } from "@/components/ui/button"
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

const DEFAULT_PROJECT_VALUE = "__h_office_default__"

function projectLabel(project: ProjectRow): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

export function WorkCalendarEventDialog({
  projects,
  defaultProjectId,
  today,
}: {
  readonly projects: readonly ProjectRow[]
  readonly defaultProjectId: string | null
  readonly today: string
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [projectValue, setProjectValue] = React.useState(
    defaultProjectId ? DEFAULT_PROJECT_VALUE : ""
  )
  const [startDate, setStartDate] = React.useState(today)
  const [endDate, setEndDate] = React.useState(today)

  function reset(): void {
    setTitle("")
    setDescription("")
    setProjectValue(defaultProjectId ? DEFAULT_PROJECT_VALUE : "")
    setStartDate(today)
    setEndDate(today)
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const projectId =
      projectValue === DEFAULT_PROJECT_VALUE ? null : projectValue || null

    startTransition(async () => {
      const result = await createWorkCalendarEvent({
        title,
        description: description || null,
        projectId,
        startDate,
        endDate,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success("Event added to the work calendar.")
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <IconCalendarPlus className="size-4" />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add work calendar event</DialogTitle>
            <DialogDescription>
              Add a meeting or other dated event. Leave the project at its
              default to file it under H-Office.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <Label htmlFor="work-calendar-event-title">Title</Label>
              <Input
                id="work-calendar-event-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Weekly operations meeting"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="work-calendar-event-project">Project</Label>
              <Select value={projectValue} onValueChange={setProjectValue}>
                <SelectTrigger id="work-calendar-event-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {defaultProjectId && (
                    <SelectItem value={DEFAULT_PROJECT_VALUE}>
                      H-Office (default)
                    </SelectItem>
                  )}
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {projectLabel(project)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!defaultProjectId && (
                <p className="text-xs text-muted-foreground">
                  Compass could not identify one unique H-Office project, so a
                  project is required.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="work-calendar-event-start">Starts</Label>
                <Input
                  id="work-calendar-event-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="work-calendar-event-end">Ends</Label>
                <Input
                  id="work-calendar-event-end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="work-calendar-event-notes">Notes</Label>
              <Textarea
                id="work-calendar-event-notes"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional details"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                title.trim().length === 0 ||
                startDate.length === 0 ||
                endDate.length === 0 ||
                (!defaultProjectId && projectValue.length === 0)
              }
            >
              {pending ? "Adding…" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
