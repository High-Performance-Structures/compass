"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCheck,
  IconChevronDown,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

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
  readonly triggerLabel?: string
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

function optionMatches(
  option: ProjectTaskAssigneeOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true

  return normalizeChoice(
    [
      option.name,
      option.label,
      option.companyName,
      option.email,
      option.contactType,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
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
  triggerLabel = "Task",
}: ProjectTaskCreateButtonProps): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [assigneePickerOpen, setAssigneePickerOpen] = React.useState(false)
  const [assigneeQuery, setAssigneeQuery] = React.useState("")
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
  const normalizedAssigneeQuery = normalizeChoice(assigneeQuery)
  const projectAssigneeOptions = assigneeOptions.filter(
    (option) =>
      option.source === "project" &&
      optionMatches(option, normalizedAssigneeQuery)
  )
  const directoryAssigneeOptions = assigneeOptions.filter(
    (option) =>
      option.source === "directory" &&
      optionMatches(option, normalizedAssigneeQuery)
  )
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

  function selectAssignee(option: ProjectTaskAssigneeOption): void {
    setSelectedAssigneeId(option.id)
    setAssigneeName(option.name)
    setCompanyName(option.companyName ?? "")
    setAssigneeQuery("")
    setAssigneePickerOpen(false)
  }

  function useTypedAssignee(): void {
    const typedName = assigneeQuery.trim()
    if (!typedName) return

    setSelectedAssigneeId(null)
    setAssigneeName(typedName)
    setAssigneeQuery("")
    setAssigneePickerOpen(false)
  }

  function clearAssignee(): void {
    setSelectedAssigneeId(null)
    setAssigneeName("")
    setCompanyName("")
    setAssigneeQuery("")
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
      message: "Task created and added to the project work queue.",
    })
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
        <Button type="button" variant="outline" size="sm">
          <IconListCheck className="size-4" />
          {triggerLabel}
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
              <Popover
                open={assigneePickerOpen}
                onOpenChange={setAssigneePickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    id={`task-assignee-${sourceRecordId ?? sourceLabel}`}
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-10 w-full justify-between rounded-md bg-background px-3 text-left font-normal",
                      !assigneeName && "text-muted-foreground"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {assigneeName || "Choose contact..."}
                    </span>
                    <IconChevronDown className="size-4 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[min(28rem,calc(100vw-3rem))] p-0"
                >
                  <div className="border-b p-3">
                    <Input
                      value={assigneeQuery}
                      onChange={(event) => setAssigneeQuery(event.target.value)}
                      placeholder="Search contacts or type a name..."
                      autoFocus
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {projectAssigneeOptions.length > 0 && (
                      <div className="space-y-1">
                        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                          Project contacts
                        </p>
                        {projectAssigneeOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => selectAssignee(option)}
                            className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {option.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {option.companyName ?? option.contactType}
                              </span>
                            </span>
                            {selectedAssigneeId === option.id && (
                              <IconCheck className="mt-0.5 size-4 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {directoryAssigneeOptions.length > 0 && (
                      <div className="mt-2 space-y-1 border-t pt-2">
                        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                          Directory contacts
                        </p>
                        {directoryAssigneeOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => selectAssignee(option)}
                            className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {option.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                Not on this project yet
                              </span>
                            </span>
                            {selectedAssigneeId === option.id && (
                              <IconCheck className="mt-0.5 size-4 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {normalizedAssigneeQuery &&
                      projectAssigneeOptions.length === 0 &&
                      directoryAssigneeOptions.length === 0 && (
                        <p className="px-2 py-3 text-sm text-muted-foreground">
                          No matching contacts.
                        </p>
                      )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAssignee}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!assigneeQuery.trim()}
                      onClick={useTypedAssignee}
                    >
                      Use typed name
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
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

          {directoryAssignee && (
            <div className="border-l-4 border-[#9d832c] bg-card px-3 py-2 text-sm text-foreground">
              <p className="font-medium">
                {directoryAssignee.name} is in the directory, but not on this
                project yet.
              </p>
              <p className="mt-1 text-amber-900">
                You can create the task without changing project contacts, or
                add this contact to the project first. Portal visibility still
                needs a separate review.
              </p>
            </div>
          )}
          {hasUnmatchedAssignee && (
            <div className="border-l-2 border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <p>
                This assignee is not matched to a contact yet. Compass can save
                the task label, but notifications need a matched contact.
              </p>
            </div>
          )}

          {status.kind === "saved" && (
            <p className="rounded-md border border-[#3f7d4d] bg-card px-3 py-2 text-sm text-[#3f7d4d]">
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
                    ? "Assign task only"
                    : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
