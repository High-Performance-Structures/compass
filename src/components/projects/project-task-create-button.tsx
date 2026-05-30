"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconListCheck, IconPlus } from "@tabler/icons-react"

import {
  createProjectTask,
  type ProjectTaskRecordType,
} from "@/app/actions/project-operations"
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
import { Textarea } from "@/components/ui/textarea"

type TaskStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

type ProjectTaskCreateButtonProps = {
  readonly projectId: string
  readonly sourceLabel: string
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly sourceHref: string | null
  readonly defaultTitle: string
  readonly defaultDescription: string | null
  readonly defaultAssigneeName: string | null
  readonly defaultCompanyName: string | null
  readonly defaultDueDate: string | null
  readonly defaultPriority: string
  readonly defaultTaskType?: ProjectTaskRecordType
}

function cleanValue(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function defaultDescriptionText(input: {
  readonly sourceLabel: string
  readonly sourceRecordNumber: string | null
  readonly description: string | null
}): string {
  return [
    input.description,
    "",
    `Created from ${input.sourceLabel}${
      input.sourceRecordNumber ? ` ${input.sourceRecordNumber}` : ""
    }.`,
  ]
    .filter((line) => line !== null)
    .join("\n")
    .trim()
}

export function ProjectTaskCreateButton({
  projectId,
  sourceLabel,
  sourceRecordId,
  sourceRecordNumber,
  sourceHref,
  defaultTitle,
  defaultDescription,
  defaultAssigneeName,
  defaultCompanyName,
  defaultDueDate,
  defaultPriority,
  defaultTaskType = "staff_task",
}: ProjectTaskCreateButtonProps): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(defaultTitle)
  const [description, setDescription] = React.useState(
    defaultDescriptionText({
      sourceLabel,
      sourceRecordNumber,
      description: defaultDescription,
    })
  )
  const [taskType, setTaskType] =
    React.useState<ProjectTaskRecordType>(defaultTaskType)
  const [assigneeName, setAssigneeName] = React.useState(
    defaultAssigneeName ?? ""
  )
  const [companyName, setCompanyName] = React.useState(defaultCompanyName ?? "")
  const [dueDate, setDueDate] = React.useState(defaultDueDate ?? "")
  const [priority, setPriority] = React.useState(defaultPriority)
  const [status, setStatus] = React.useState<TaskStatus>({ kind: "idle" })

  async function submitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "saving" })

    const result = await createProjectTask(projectId, {
      title,
      description,
      sourceRecordType: taskType,
      sourceRecordId,
      sourceRecordNumber,
      assigneeName: cleanValue(assigneeName),
      companyName: cleanValue(companyName),
      startDate: null,
      dueDate: cleanValue(dueDate),
      priority,
      externalUrl: sourceHref,
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setStatus({
      kind: "saved",
      message: "Task created and added to the project work queue.",
    })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconListCheck className="size-4" />
          Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submitTask} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>
              Add a to-do from this {sourceLabel.toLowerCase()}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`task-title-${sourceRecordId ?? sourceLabel}`}>
              Task
            </Label>
            <Input
              id={`task-title-${sourceRecordId ?? sourceLabel}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`task-type-${sourceRecordId ?? sourceLabel}`}>
                Type
              </Label>
              <select
                id={`task-type-${sourceRecordId ?? sourceLabel}`}
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
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="staff_task">Internal staff task</option>
                <option value="subcontractor_task">Subcontractor task</option>
                <option value="supplier_task">Supplier task</option>
                <option value="schedule_task">Schedule follow-up</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`task-priority-${sourceRecordId ?? sourceLabel}`}>
                Priority
              </Label>
              <select
                id={`task-priority-${sourceRecordId ?? sourceLabel}`}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`task-assignee-${sourceRecordId ?? sourceLabel}`}>
                Assigned to
              </Label>
              <Input
                id={`task-assignee-${sourceRecordId ?? sourceLabel}`}
                value={assigneeName}
                onChange={(event) => setAssigneeName(event.target.value)}
                placeholder="Person or role"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`task-company-${sourceRecordId ?? sourceLabel}`}>
                Company
              </Label>
              <Input
                id={`task-company-${sourceRecordId ?? sourceLabel}`}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`task-due-${sourceRecordId ?? sourceLabel}`}>
                Due
              </Label>
              <Input
                id={`task-due-${sourceRecordId ?? sourceLabel}`}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`task-description-${sourceRecordId ?? sourceLabel}`}>
              Notes
            </Label>
            <Textarea
              id={`task-description-${sourceRecordId ?? sourceLabel}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-32"
            />
          </div>

          {status.kind === "saved" && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={status.kind === "saving" || status.kind === "saved"}
            >
              {status.kind === "saved" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconPlus className="size-4" />
              )}
              {status.kind === "saving"
                ? "Creating..."
                : status.kind === "saved"
                  ? "Created"
                  : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
