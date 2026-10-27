"use client"

import { ON_BUDGET_GROUP, INTERNAL_CODES_GROUP } from "@/lib/daily-logs/cost-code-groups"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  IconArchive,
  IconDeviceFloppy,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import {
  archiveProjectTodo,
  deleteProjectTodo,
  getProjectTodoDetail,
  restoreProjectTodo,
  setProjectTodoStatus,
  updateProjectTodo,
  type ProjectOperationItem,
  type ProjectTaskRecordType,
  type ProjectTodoDetail,
} from "@/app/actions/project-operations"
import { ProjectTodoHistory } from "@/components/projects/project-todo-history"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { ProjectCompanyPicker } from "@/components/projects/project-company-picker"
import { useDeveloperMode } from "@/components/developer-mode-provider"
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
  isSelectableProjectTodoStatus,
  normalizeProjectTodoStatus,
  PROJECT_TODO_SELECTABLE_STATUSES,
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
  if (item.sourceSystem === "compass_template") return "Created from a Compass template"
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
  const { developerModeEnabled } = useDeveloperMode()
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
  const [costCode, setCostCode] = React.useState(item.costCode ?? "")
  const [detail, setDetail] = React.useState<ProjectTodoDetail | null>(null)
  const archived = isArchivedProjectTodoStatus(item.status)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    getProjectTodoDetail(projectId, item.id)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch(() => {
        if (!cancelled) setDetail({ history: [], hours: 0, workedLogCount: 0, finishNudgeAfterLogs: 0, costCodes: [] })
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId, item.id])
  const costCodeOptions = React.useMemo(
    () => (detail?.costCodes ?? []).map((option) => ({ value: option.code, browseGroup: option.group, onBudget: option.group === ON_BUDGET_GROUP || option.group === INTERNAL_CODES_GROUP, label: option.label, keywords: `${option.code} ${option.name}` })),
    [detail?.costCodes],
  )

  async function markFinished(): Promise<void> {
    setSaveState({ kind: "saving" })
    const result = await setProjectTodoStatus(projectId, item.id, "complete", item.updatedAt)
    if (!result.success) {
      setSaveState({ kind: "error", message: result.error })
      return
    }
    onOpenChange(false)
    router.refresh()
  }

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
      ...(costCodeOptions.length > 0 ? { costCode: cleanValue(costCode) } : {}),
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

  async function remove(): Promise<void> {
    setSaveState({ kind: "saving" })
    const result = await deleteProjectTodo(
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
              {developerModeEnabled ? (
                <>
                  {sourceLabel(item)}
                  {item.sourceRecordNumber
                    ? ` · ${item.sourceRecordNumber}`
                    : ""}
                  . Original source identifiers remain preserved when this record
                  is updated in Compass.
                </>
              ) : (
                "Update assignment, dates, status, and notes."
              )}
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
              <Select
                value={taskType}
                onValueChange={(value) => {
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
              >
                <SelectTrigger id={`todo-type-${item.id}`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff_task">Internal staff</SelectItem>
                  <SelectItem value="subcontractor_task">Subcontractor</SelectItem>
                  <SelectItem value="supplier_task">Supplier</SelectItem>
                  <SelectItem value="schedule_task">Schedule follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-status-${item.id}`}>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  if (isSelectableProjectTodoStatus(value)) {
                    setStatus(value)
                  }
                }}
                disabled={archived}
              >
                <SelectTrigger id={`todo-status-${item.id}`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TODO_SELECTABLE_STATUSES.map((selectableStatus) => (
                    <SelectItem key={selectableStatus} value={selectableStatus}>
                      {projectTodoStatusLabel(selectableStatus)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`todo-priority-${item.id}`}>Priority</Label>
              <Select value={priority} onValueChange={setPriority} disabled={archived}>
                <SelectTrigger id={`todo-priority-${item.id}`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
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
                  setCompanyName(option?.companyName ?? "")
                }}
                className="h-10"
                disabled={archived}
              />
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <ProjectCompanyPicker
                value={companyName}
                options={assigneeOptions}
                onValueChange={setCompanyName}
                className="h-10"
                disabled={archived}
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

          {costCodeOptions.length > 0 && (
            <div className="space-y-2 sm:max-w-sm">
              <Label htmlFor={`todo-cost-code-${item.id}`}>Cost code</Label>
              <SearchableCombobox
                id={`todo-cost-code-${item.id}`}
                ariaLabel="Cost code"
                options={costCodeOptions}
                value={costCode}
                onValueChange={(value) => {
                  if (value && value !== costCode) setCostCode(value)
                }}
                placeholder="No cost code"
                searchPlaceholder="Search cost codes..."
                emptyMessage="No matching cost codes."
                disabled={archived}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">Ticking this to-do on a daily log adds a line with this code for its hours.</p>
            </div>
          )}

          <ProjectTodoHistory
            projectId={projectId}
            detail={detail}
            finished={archived || normalizeProjectTodoStatus(item.status) === "complete"}
            onMarkFinished={() => void markFinished()}
            busy={saveState.kind === "saving"}
          />

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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={restore}
                  disabled={saveState.kind === "saving"}
                >
                  <IconRestore className="size-4" />
                  Restore to-do
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={saveState.kind === "saving"}
                    >
                      <IconTrash className="size-4" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this to-do permanently?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. The to-do and its history will be
                        permanently removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep to-do</AlertDialogCancel>
                      <AlertDialogAction onClick={remove}>
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
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
                      the Archived filter.
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
