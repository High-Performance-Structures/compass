"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCheck,
  IconListCheck,
  IconPlus,
} from "@tabler/icons-react"

import {
  addDirectoryContactToProjectForTask,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts"
import {
  createProjectTask,
  type ProjectTaskRecordType,
} from "@/app/actions/project-operations"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { ProjectCompanyPicker } from "@/components/projects/project-company-picker"
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
  readonly assigneeOptions?: readonly ProjectTaskAssigneeOption[]
  readonly compact?: boolean
  readonly defaultOpen?: boolean
  readonly onCreated?: (todoId: string) => void
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

function normalizeChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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
  assigneeOptions = [],
  compact = false,
  defaultOpen = false,
  onCreated,
}: ProjectTaskCreateButtonProps): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(defaultOpen)
  const [selectedAssigneeId, setSelectedAssigneeId] = React.useState<
    string | null
  >(null)
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
  const selectedAssignee = selectedAssigneeId
    ? assigneeOptions.find((option) => option.id === selectedAssigneeId) ?? null
    : (() => {
        const normalized = normalizeChoice(assigneeName)
        if (!normalized) return null

        return (
          assigneeOptions.find(
            (option) =>
              normalizeChoice(option.label) === normalized ||
              normalizeChoice(option.name) === normalized
          ) ?? null
        )
      })()
  const directoryAssignee =
    selectedAssignee?.source === "directory" ? selectedAssignee : null
  const hasAssigneeText = assigneeName.trim().length > 0
  const hasUnmatchedAssignee = hasAssigneeText && !selectedAssignee

  function changeAssignee(
    value: string,
    option: ProjectTaskAssigneeOption | null
  ): void {
    setSelectedAssigneeId(option?.id ?? null)
    setAssigneeName(value)
    setCompanyName(option?.companyName ?? "")
  }

  async function saveTask(input?: {
    readonly assigneeName: string
    readonly companyName: string
  }): Promise<void> {
    setStatus({ kind: "saving" })
    const assignedName = input?.assigneeName ?? selectedAssignee?.name ?? assigneeName
    const assignedCompany =
      input?.companyName ?? selectedAssignee?.companyName ?? companyName

    const result = await createProjectTask(projectId, {
      title,
      description,
      sourceRecordType: taskType,
      sourceRecordId,
      sourceRecordNumber,
      assigneeName: cleanValue(assignedName),
      companyName: cleanValue(assignedCompany),
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
      message: "To-do created and added to the project work queue.",
    })
    onCreated?.(result.id)
    router.refresh()
  }

  async function submitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await saveTask()
  }

  async function addToProjectAndAssign(): Promise<void> {
    if (!directoryAssignee?.directoryContactId) return

    setStatus({ kind: "saving" })
    const result = await addDirectoryContactToProjectForTask(
      projectId,
      directoryAssignee.directoryContactId
    )

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setAssigneeName(result.contact.label)
    setCompanyName(result.contact.companyName ?? "")
    await saveTask({
      assigneeName: result.contact.name,
      companyName: result.contact.companyName ?? "",
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon" : "sm"}
          className={compact ? "size-7" : undefined}
          title={compact ? "Create linked to-do" : undefined}
        >
          <IconListCheck className="size-4" />
          {compact ? (
            <span className="sr-only">Create linked to-do</span>
          ) : (
            "To-do"
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submitTask} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create to-do</DialogTitle>
            <DialogDescription>
              Add an assignable to-do from this {sourceLabel.toLowerCase()}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`task-title-${sourceRecordId ?? sourceLabel}`}>
              To-do
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
                <option value="staff_task">Internal staff to-do</option>
                <option value="subcontractor_task">Subcontractor to-do</option>
                <option value="supplier_task">Supplier to-do</option>
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
              <Label>Assigned to</Label>
              <ProjectAssigneePicker
                value={assigneeName}
                options={assigneeOptions}
                onValueChange={changeAssignee}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <ProjectCompanyPicker
                value={companyName}
                options={assigneeOptions}
                onValueChange={setCompanyName}
                className="h-10"
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

          {directoryAssignee && (
            <div className="border-l-4 border-brand-nutech-gold bg-card px-3 py-2 text-sm text-foreground">
              <p className="font-medium">
                {directoryAssignee.name} is in the directory, but not on this
                project yet.
              </p>
              <p className="mt-1 text-amber-900">
                You can create the to-do without changing project contacts, or
                add this contact to the project first. Portal visibility still
                needs a separate review.
              </p>
            </div>
          )}
          {hasUnmatchedAssignee && (
            <div className="border-l-2 border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <p>
                This assignee is not matched to a contact yet. Compass can save
                the to-do label, but notifications need a matched contact.
              </p>
            </div>
          )}

          {status.kind === "saved" && (
            <p className="rounded-md border border-brand-hps-primary bg-card px-3 py-2 text-sm text-brand-hps-primary">
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <DialogFooter>
            {directoryAssignee && (
              <Button
                type="button"
                variant="outline"
                disabled={status.kind === "saving" || status.kind === "saved"}
                onClick={addToProjectAndAssign}
              >
                Add to project and assign
              </Button>
            )}
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
                  : directoryAssignee
                    ? "Assign to-do only"
                    : "Create to-do"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
