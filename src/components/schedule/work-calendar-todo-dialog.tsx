"use client"

import * as React from "react"
import { IconClipboardPlus } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createProjectTask } from "@/app/actions/project-operations"
import type { ProjectRow } from "@/app/actions/work-calendar"
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

function projectLabel(project: ProjectRow): string {
  return project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
}

export function WorkCalendarTodoDialog({
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
  const [projectId, setProjectId] = React.useState(defaultProjectId ?? "")
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [assigneeName, setAssigneeName] = React.useState("")
  const [companyName, setCompanyName] = React.useState("")
  const [dueDate, setDueDate] = React.useState(today)
  const [priority, setPriority] = React.useState("normal")

  function reset(): void {
    setProjectId(defaultProjectId ?? "")
    setTitle("")
    setDescription("")
    setAssigneeName("")
    setCompanyName("")
    setDueDate(today)
    setPriority("normal")
  }

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) reset()
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!projectId) {
      toast.error("Select the project for this to-do.")
      return
    }

    startTransition(async () => {
      const result = await createProjectTask(projectId, {
        title,
        description: description.trim() || null,
        sourceRecordType: "staff_task",
        sourceRecordId: null,
        sourceRecordNumber: null,
        assigneeName: assigneeName.trim() || null,
        companyName: companyName.trim() || null,
        startDate: null,
        dueDate: dueDate || null,
        priority,
        externalUrl: null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("To-do added to the project work queue.")
      changeOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <IconClipboardPlus className="size-4" />
          Add to-do
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add to-do</DialogTitle>
            <DialogDescription>
              Create project work directly without starting from a log,
              schedule item, or RFI.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <Label htmlFor="calendar-todo-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="calendar-todo-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {projectLabel(project)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="calendar-todo-title">Title</Label>
              <Input
                id="calendar-todo-title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="calendar-todo-assignee">Assignee</Label>
                <Input
                  id="calendar-todo-assignee"
                  value={assigneeName}
                  onChange={(event) =>
                    setAssigneeName(event.currentTarget.value)
                  }
                  placeholder="Name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="calendar-todo-company">Company</Label>
                <Input
                  id="calendar-todo-company"
                  value={companyName}
                  onChange={(event) =>
                    setCompanyName(event.currentTarget.value)
                  }
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="calendar-todo-due">Due date</Label>
                <Input
                  id="calendar-todo-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.currentTarget.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="calendar-todo-priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="calendar-todo-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="calendar-todo-description">Description</Label>
              <Textarea
                id="calendar-todo-description"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                maxLength={5_000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !projectId || !title.trim()}
            >
              {pending ? "Saving…" : "Add to-do"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
