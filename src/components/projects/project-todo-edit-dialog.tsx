"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconArchive, IconDeviceFloppy, IconRestore } from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import {
  archiveProjectTodo,
  restoreProjectTodo,
  updateProjectTodo,
  type ProjectOperationItem,
  type ProjectTaskRecordType,
} from "@/app/actions/project-operations"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  canonicalProjectTodoRecordType,
  isArchivedProjectTodoStatus,
  normalizeProjectTodoStatus,
  projectTodoStatusLabel,
} from "@/lib/project-todos"

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "error"; readonly message: string }

function cleanValue(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sourceLabel(item: ProjectOperationItem): string {
  if (item.sourceSystem === "buildertrend") return "Imported from Buildertrend"
  if (item.sourceSystem === "compass") return "Created in Compass"
  if (item.sourceSystem === "sage") return "Imported from Sage"
  return `Imported from ${item.sourceSystem}`
}

export function ProjectTodoEditDialog({
  projectId,
  item,
  assigneeOptions,
  open,
  onOpenChange,
}: {
  readonly projectId: string
  readonly item: ProjectOperationItem
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [title, setTitle] = React.useState(item.title)
  const [description, setDescription] = React.useState(item.description ?? "")
  const [taskType, setTaskType] = React.useState<ProjectTaskRecordType>(
    canonicalProjectTodoRecordType(item.sourceRecordType)
  )
  const [status, setStatus] = React.useState(
    normalizeProjectTodoStatus(item.status)
  )
  const [priority, setPriority] = React.useState(item.priority)
  const [assigneeName, setAssigneeName] = React.useState(
    item.assigneeName ?? ""
  )
  const [companyName, setCompanyName] = React.useState(item.companyName ?? "")
  const [startDate, setStartDate] = React.useState(item.startDate ?? "")
  const [dueDate, setDueDate] = React.useState(item.dueDate ?? "")
  const [saveState, setSaveState] = React.useState<SaveState>({ kind: "idle" })
  const archived = isArchivedProjectTodoStatus(item.status)

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaveState({ kind: "saving" })
    const result = await updateProjectTodo(projectId, item.id, {
      title,
      description: cleanValue(description),
      sourceRecordType: taskType,
      status,
      priority,
      assigneeName: cleanValue(assigneeName),
      companyName: cleanValue(companyName),
      startDate: cleanValue(startDate),
      dueDate: cleanValue(dueDate),
      expectedUpdatedAt: item.updatedAt,
    })

    if (!result.success) {
      setSaveState({ kind: "error", message: result.error })
      return
    }

    onOpenChange(false)
    router.refresh()
  }

  async function archive(): Promise<void> {
    setSaveState({ kind: "saving" })
    const result = await archiveProjectTodo(
      projectId,
      item.id,
      item.updatedAt
    )
    if (!result.success) {
      setSaveState({ kind: "error", message: result.error })
      return
    }

    onOpenChange(false)
    router.refresh()
  }

  async function restore(): Promise<void> {
    setSaveState({ kind: "saving" })
    const result = await restoreProjectTodo(
      projectId,
      item.id,
      item.updatedAt
    )
    if (!result.success) {
      setSaveState({ kind: "error", message: result.error })
      return
    }

    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Edit to-do</DialogTitle>
            <DialogDescription>
              {sourceLabel(item)}
              {item.sourceRecordNumber
                ? ` · ${item.sourceRecordNumber}`
                : ""}
              . Original source identifiers remain preserved when this record is
              updated in Compass.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`todo-title-${item.id}`}>To-do</Label>
            <Input
              id={`todo-title-${item.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={archived}
              required
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`todo-type-${item.id}`}>Type</Label>
              <select
                id={`todo-type-${item.id}`}
                value={taskType}
                onChange={(event) => {
                  const value = event.target.value
                  if (
                    value === "staff_task" ||
                    value === "subcontractor_task" ||
                    value === "supplier_task" ||
                    value === "schedule_task"
                  ) {
                    setTaskType(value)
                  }
                }}
                disabled={archived}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="staff_task">Internal staff</option>
                <option value="subcontractor_task">Subcontractor</option>
                <option value="supplier_task">Supplier</option>
                <option value="schedule_task">Schedule follow-up</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-status-${item.id}`}>Status</Label>
              <select
                id={`todo-status-${item.id}`}
                value={status}
                onChange={(event) => {
                  const value = event.target.value
                  if (
                    value === "open" ||
                    value === "in_progress" ||
                    value === "blocked" ||
                    value === "complete"
                  ) {
                    setStatus(value)
                  }
                }}
                disabled={archived}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="complete">Complete</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-priority-${item.id}`}>Priority</Label>
              <select
                id={`todo-priority-${item.id}`}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                disabled={archived}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Assigned to</Label>
              <ProjectAssigneePicker
                value={assigneeName}
                options={assigneeOptions}
                onValueChange={(value, option) => {
                  setAssigneeName(value)
                  if (option?.companyName) setCompanyName(option.companyName)
                }}
                className="h-10"
                disabled={archived}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-company-${item.id}`}>Company</Label>
              <Input
                id={`todo-company-${item.id}`}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                disabled={archived}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`todo-start-${item.id}`}>Start date</Label>
              <Input
                id={`todo-start-${item.id}`}
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={archived}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-due-${item.id}`}>Due date</Label>
              <Input
                id={`todo-due-${item.id}`}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={archived}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`todo-description-${item.id}`}>Notes</Label>
            <Textarea
              id={`todo-description-${item.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={archived}
              className="min-h-32"
            />
          </div>

          {archived && (
            <p className="border-l-2 border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground">
              This to-do is archived. Restore it before making changes.
            </p>
          )}
          {saveState.kind === "error" && (
            <p className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
              {saveState.message}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {archived ? (
              <Button
                type="button"
                variant="outline"
                onClick={restore}
                disabled={saveState.kind === "saving"}
              >
                <IconRestore className="size-4" />
                Restore to-do
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saveState.kind === "saving"}
                  >
                    <IconArchive className="size-4" />
                    Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive this to-do?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It will leave active work views but remain available in
                      the Archived filter with its source history intact.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep active</AlertDialogCancel>
                    <AlertDialogAction onClick={archive}>
                      Archive to-do
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {!archived && (
              <Button type="submit" disabled={saveState.kind === "saving"}>
                <IconDeviceFloppy className="size-4" />
                {saveState.kind === "saving" ? "Saving..." : "Save changes"}
              </Button>
            )}
          </div>

          {archived && (
            <p className="text-xs text-muted-foreground">
              Current status: {projectTodoStatusLabel(item.status)}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
