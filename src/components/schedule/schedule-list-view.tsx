"use client"

import type { ScheduleConflict } from "@/lib/schedule/conflicts"
import { useState, useCallback, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  IconPencil,
  IconTrash,
  IconLink,
  IconCircleCheck,
  IconX,
} from "@tabler/icons-react"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import { DependencyDialog } from "./dependency-dialog"
import { scheduleListColumns } from "./schedule-list-columns"
import {
  assignScheduleTasks,
  completeScheduleTasks,
  deleteScheduleTasks,
} from "@/app/actions/schedule-tasks"
import { addDirectoryContactToProjectForTask } from "@/app/actions/project-contact-assignees"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import {
  SCHEDULE_LIST_COLUMNS,
  type ScheduleListColumn,
} from "@/lib/schedule/saved-views"
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
} from "@/components/ui/alert-dialog"

interface ScheduleListViewProps {
  readonly projectId: string | null
  readonly tasks: ScheduleTaskData[]
  readonly dependencies: TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly focusTaskId?: string | null
  readonly projects?: readonly ScheduleProjectData[]
  readonly visibleColumns?: readonly ScheduleListColumn[]
  /** Items whose crew is booked on another job over the same days. */
  readonly conflicts?: ReadonlyMap<string, readonly ScheduleConflict[]>
  /** False until the schedule is first published; drafts need no shift reason. */
  readonly shiftReasonRequired?: boolean
}

const NO_CONFLICTS: ReadonlyMap<string, readonly ScheduleConflict[]> = new Map()

export function ScheduleListView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  assigneeOptions,
  focusTaskId = null,
  projects = [],
  visibleColumns = SCHEDULE_LIST_COLUMNS,
  conflicts = NO_CONFLICTS,
  shiftReasonRequired = true,
}: ScheduleListViewProps) {
  const router = useRouter()
  const displayColorPalette = useScheduleDisplayPalette(projectId ?? "unified")
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(null)
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [localTasks, setLocalTasks] = useState(tasks)
  const [pendingDeleteTasks, setPendingDeleteTasks] = useState<
    readonly ScheduleTaskData[]
  >([])
  const [isWorking, setIsWorking] = useState(false)
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const multipleProjects = projectById.size > 1

  useEffect(() => {
    setLocalTasks(tasks)
  }, [tasks])

  const handleEdit = useCallback((task: ScheduleTaskData) => {
    setEditingTask(task)
    setTaskFormOpen(true)
  }, [])

  const columns = useMemo(
    () =>
      scheduleListColumns({
        visibleColumns,
        multipleProjects,
        projectById,
        conflicts,
        palette: displayColorPalette,
        assigneeOptions,
        onEdit: handleEdit,
        onDelete: (task) => setPendingDeleteTasks([task]),
      }),
    [
      assigneeOptions,
      conflicts,
      displayColorPalette,
      handleEdit,
      multipleProjects,
      projectById,
      visibleColumns,
    ]
  )

  // The schedule's own filters (search, status, phase, preset) and order
  // mode shape `tasks`; the sheet keeps that order until a header is clicked.
  const table = useRecordTable({
    data: localTasks,
    columns,
    getRowId: (task) => task.id,
    resetKey: projectId ?? "unified",
    enableSelection: true,
    initialItemId: focusTaskId,
    sheetId: "schedule.list",
  })
  const selectedTasks = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)

  function selectedByProject(): ReadonlyMap<string, readonly string[]> {
    const grouped = new Map<string, string[]>()
    for (const task of selectedTasks) {
      const current = grouped.get(task.projectId) ?? []
      current.push(task.id)
      grouped.set(task.projectId, current)
    }
    return grouped
  }

  const handleCompleteSelected = async (): Promise<void> => {
    const selectedIds = selectedTasks.map((task) => task.id)
    if (selectedIds.length === 0) return

    setIsWorking(true)
    const results = await Promise.all(
      [...selectedByProject()].map(([selectedProjectId, ids]) =>
        completeScheduleTasks(selectedProjectId, ids)
      )
    )
    setIsWorking(false)

    const failedResult = results.find((result) => !result.success)
    if (failedResult && !failedResult.success) {
      toast.error(failedResult.error)
      return
    }

    const completedIds = new Set(selectedIds)
    setLocalTasks((current) =>
      current.map((task) =>
        completedIds.has(task.id)
          ? { ...task, status: "COMPLETE", percentComplete: 100 }
          : task
      )
    )
    table.resetRowSelection()
    toast.success(
      `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} marked complete.`
    )
    router.refresh()
  }

  const handleAssignSelected = async (
    value: string,
    option: ProjectTaskAssigneeOption | null
  ): Promise<void> => {
    const selectedIds = selectedTasks.map((task) => task.id)
    if (selectedIds.length === 0) return

    setIsWorking(true)
    let assignedName = value.trim()
    if (option?.source === "directory" && option.directoryContactId) {
      for (const selectedProjectId of selectedByProject().keys()) {
        const contactResult = await addDirectoryContactToProjectForTask(
          selectedProjectId,
          option.directoryContactId
        )
        if (!contactResult.success) {
          setIsWorking(false)
          toast.error(contactResult.error)
          return
        }
        assignedName = contactResult.contact.name
      }
    }

    const results = await Promise.all(
      [...selectedByProject()].map(([selectedProjectId, ids]) =>
        assignScheduleTasks(
          selectedProjectId,
          ids,
          assignedName || null
        )
      )
    )
    setIsWorking(false)

    const failedResult = results.find((result) => !result.success)
    if (failedResult && !failedResult.success) {
      toast.error(failedResult.error)
      return
    }

    const assignedIds = new Set(selectedIds)
    setLocalTasks((current) =>
      current.map((task) =>
        assignedIds.has(task.id)
          ? { ...task, assignedTo: assignedName || null, people: [] }
          : task
      )
    )
    table.resetRowSelection()
    toast.success(
      assignedName
        ? `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} assigned to ${assignedName}.`
        : `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} unassigned.`
    )
    router.refresh()
  }

  const handleConfirmDelete = async (): Promise<void> => {
    const deletingTasks = pendingDeleteTasks
    const selectedIds = deletingTasks.map((task) => task.id)
    if (selectedIds.length === 0) return

    setIsWorking(true)
    const grouped = new Map<string, string[]>()
    for (const task of deletingTasks) {
      const current = grouped.get(task.projectId) ?? []
      current.push(task.id)
      grouped.set(task.projectId, current)
    }
    const results = await Promise.all(
      [...grouped].map(([selectedProjectId, ids]) =>
        deleteScheduleTasks(selectedProjectId, ids)
      )
    )
    setIsWorking(false)

    const failedResult = results.find((result) => !result.success)
    if (failedResult && !failedResult.success) {
      toast.error(failedResult.error)
      return
    }

    const deletedIds = new Set(selectedIds)
    setLocalTasks((current) =>
      current.filter((task) => !deletedIds.has(task.id))
    )
    table.resetRowSelection()
    setPendingDeleteTasks([])
    toast.success(
      `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} deleted.`
    )
    router.refresh()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-1 flex h-8 shrink-0 min-w-0 flex-nowrap items-center gap-1 overflow-x-auto"
        data-schedule-list-actions
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => setDepDialogOpen(true)}
          disabled={!projectId || localTasks.length < 2}
          title={
            projectId
              ? "Add a dependency"
              : "Choose one project to manage dependencies"
          }
        >
          <IconLink className="size-4 mr-1" />
          Add Dependency
        </Button>
        {selectedTasks.length > 0 && (
          <>
            <span
              className="ml-auto text-sm font-medium"
              aria-live="polite"
            >
              {selectedTasks.length} selected
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedTasks.length !== 1 || isWorking}
              onClick={() => {
                const task = selectedTasks[0]
                if (task) handleEdit(task)
              }}
            >
              <IconPencil className="size-4" />
              Edit selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isWorking}
              onClick={handleCompleteSelected}
            >
              <IconCircleCheck className="size-4" />
              Mark complete
            </Button>
            <div className="w-[220px]">
              <ProjectAssigneePicker
                value=""
                options={assigneeOptions}
                disabled={isWorking}
                placeholder="Assign / reassign"
                clearLabel="Unassign selected"
                className="h-8 text-xs"
                onValueChange={(value, option) => {
                  void handleAssignSelected(value, option)
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isWorking}
              onClick={() => setPendingDeleteTasks(selectedTasks)}
            >
              <IconTrash className="size-4" />
              Delete selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isWorking}
              onClick={() => table.resetRowSelection()}
            >
              <IconX className="size-4" />
              Clear
            </Button>
          </>
        )}
      </div>

      <div className="min-h-[30rem] flex-1">
        <RecordTable
          table={table}
          itemLabel="schedule items"
          emptyMessage='No schedule items yet. Click "New Schedule Item" to get started.'
          focusedRowId={focusTaskId}
          rowIdPrefix="schedule-item"
          onRowOpen={handleEdit}
        />
      </div>

      {(editingTask || projectId) && (
        <ScheduleItemFormDialog
          open={taskFormOpen}
          onOpenChange={setTaskFormOpen}
          projectId={editingTask?.projectId ?? projectId ?? ""}
          editingTask={editingTask}
          allTasks={localTasks.filter(
            (task) =>
              task.projectId === (editingTask?.projectId ?? projectId)
          )}
          dependencies={dependencies}
          exceptions={exceptions.filter(
            (exception) =>
              exception.projectId === (editingTask?.projectId ?? projectId)
          )}
          assigneeOptions={assigneeOptions}
          shiftReasonRequired={shiftReasonRequired}
          onDeleted={(taskId) =>
            setLocalTasks((current) => current.filter((task) => task.id !== taskId))
          }
        />
      )}

      {projectId && (
        <DependencyDialog
          open={depDialogOpen}
          onOpenChange={setDepDialogOpen}
          projectId={projectId}
          tasks={localTasks}
          dependencies={dependencies}
          shiftReasonRequired={shiftReasonRequired}
        />
      )}

      <AlertDialog
        open={pendingDeleteTasks.length > 0}
        onOpenChange={(open) => {
          if (!open && !isWorking) setPendingDeleteTasks([])
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDeleteTasks.length === 1
                ? "this schedule item"
                : `${pendingDeleteTasks.length} schedule items`}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This also removes dependencies connected to the deleted
              {pendingDeleteTasks.length === 1 ? " item" : " items"}. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>
              Keep {pendingDeleteTasks.length === 1 ? "item" : "items"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isWorking}
              onClick={handleConfirmDelete}
            >
              {isWorking ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
