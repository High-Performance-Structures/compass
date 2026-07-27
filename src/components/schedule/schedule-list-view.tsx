"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  IconPencil,
  IconTrash,
  IconLink,
  IconCircleCheck,
  IconX,
} from "@tabler/icons-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import { DependencyDialog } from "./dependency-dialog"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import {
  completeScheduleTasks,
  deleteScheduleTasks,
} from "@/app/actions/schedule"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format, parseISO } from "date-fns"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import { cn } from "@/lib/utils"
import {
  getScheduleItemDisplayColor,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"
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
  readonly projectId: string
  readonly tasks: ScheduleTaskData[]
  readonly dependencies: TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly focusTaskId?: string | null
}

function StatusDot({
  task,
  palette,
}: {
  task: ScheduleTaskData
  palette: DisplayColorPalette
}) {
  return (
    <span
      className="inline-block size-2.5 rounded-full"
      style={{ backgroundColor: getScheduleItemDisplayColor(task, palette) }}
    />
  )
}

function ProgressValue({ percent }: { readonly percent: number }) {
  return (
    <div className="w-12">
      <span className="block text-xs font-medium tabular-nums">{percent}%</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex items-center gap-1.5">
      <div className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium">
        {initials}
      </div>
      <span className="text-xs text-muted-foreground truncate max-w-[80px]">
        {name}
      </span>
    </div>
  )
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy")
  } catch {
    return dateStr
  }
}

export function ScheduleListView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  assigneeOptions,
  focusTaskId = null,
}: ScheduleListViewProps) {
  const router = useRouter()
  const displayColorPalette = useScheduleDisplayPalette(projectId)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(null)
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [localTasks, setLocalTasks] = useState(tasks)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [pendingDeleteTasks, setPendingDeleteTasks] = useState<
    readonly ScheduleTaskData[]
  >([])
  const [isWorking, setIsWorking] = useState(false)

  useEffect(() => {
    setLocalTasks(tasks)
  }, [tasks])

  const handleEdit = useCallback((task: ScheduleTaskData) => {
    setEditingTask(task)
    setTaskFormOpen(true)
  }, [])

  const columns: ColumnDef<ScheduleTaskData>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onCheckedChange={(value) =>
              table.toggleAllRowsSelected(!!value)
            }
            aria-label="Select all schedule items"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={`Select ${row.original.title}`}
          />
        ),
        size: 32,
      },
      {
        id: "idNum",
        header: "#",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.sortOrder + 1}
          </span>
        ),
        size: 40,
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <StatusDot
              task={row.original}
              palette={displayColorPalette}
            />
            <button
              type="button"
              className="max-w-[150px] truncate text-left text-sm font-medium hover:underline sm:max-w-[200px]"
              onClick={() => handleEdit(row.original)}
              aria-label={`Edit ${row.original.title}`}
              title={`Edit ${row.original.title}`}
            >
              {row.original.title}
            </button>
          </div>
        ),
      },
      {
        id: "complete",
        header: "Complete",
        cell: ({ row }) => (
          <ProgressValue
            percent={effectivePercentComplete(
              row.original.status,
              row.original.percentComplete
            )}
          />
        ),
        size: 70,
        meta: { className: "hidden sm:table-cell" },
      },
      {
        accessorKey: "phase",
        header: "Phase",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[80px] inline-block">
            {row.original.phase}
          </span>
        ),
        meta: { className: "hidden lg:table-cell" },
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.workdays} {row.original.workdays === 1 ? "day" : "days"}
          </span>
        ),
        size: 80,
        meta: { className: "hidden md:table-cell" },
      },
      {
        accessorKey: "startDate",
        header: "Start",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.startDate)}
          </span>
        ),
      },
      {
        accessorKey: "endDateCalculated",
        header: "End",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.endDateCalculated)}
          </span>
        ),
      },
      {
        id: "assignedTo",
        header: "Responsible",
        cell: ({ row }) =>
          row.original.assignedTo ? (
            <InitialsAvatar name={row.original.assignedTo} />
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <ProjectTaskCreateButton
              compact
              projectId={projectId}
              sourceLabel="Schedule item"
              sourceRecordId={row.original.id}
              sourceRecordNumber={null}
              sourceHref={`/dashboard/projects/${projectId}/schedule`}
              defaultTitle={`Follow up: ${row.original.title}`}
              defaultDescription={`${row.original.phase} schedule item.`}
              defaultAssigneeName={row.original.assignedTo}
              defaultCompanyName={null}
              defaultDueDate={row.original.endDateCalculated}
              defaultPriority={
                row.original.isCriticalPath ? "high" : "normal"
              }
              defaultTaskType="schedule_task"
              assigneeOptions={assigneeOptions}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => handleEdit(row.original)}
              aria-label={`Edit ${row.original.title}`}
              title="Edit schedule item"
            >
              <IconPencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPendingDeleteTasks([row.original])}
              aria-label={`Delete ${row.original.title}`}
              title="Delete schedule item"
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ),
        size: 110,
      },
    ],
    [assigneeOptions, displayColorPalette, handleEdit, projectId]
  )

  const table = useReactTable({
    data: localTasks,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
    initialState: { pagination: { pageSize: 25 } },
  })
  const selectedTasks = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)

  const handleCompleteSelected = async (): Promise<void> => {
    const selectedIds = selectedTasks.map((task) => task.id)
    if (selectedIds.length === 0) return

    setIsWorking(true)
    const result = await completeScheduleTasks(projectId, selectedIds)
    setIsWorking(false)

    if (!result.success) {
      toast.error(result.error)
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
    setRowSelection({})
    toast.success(
      `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} marked complete.`
    )
    router.refresh()
  }

  const handleConfirmDelete = async (): Promise<void> => {
    const deletingTasks = pendingDeleteTasks
    const selectedIds = deletingTasks.map((task) => task.id)
    if (selectedIds.length === 0) return

    setIsWorking(true)
    const result = await deleteScheduleTasks(projectId, selectedIds)
    setIsWorking(false)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    const deletedIds = new Set(selectedIds)
    setLocalTasks((current) =>
      current.filter((task) => !deletedIds.has(task.id))
    )
    setRowSelection({})
    setPendingDeleteTasks([])
    toast.success(
      `${selectedIds.length} schedule item${selectedIds.length === 1 ? "" : "s"} deleted.`
    )
    router.refresh()
  }

  useEffect(() => {
    if (!focusTaskId) return
    const index = localTasks.findIndex((task) => task.id === focusTaskId)
    if (index < 0) return

    table.setPageIndex(Math.floor(index / table.getState().pagination.pageSize))
    window.requestAnimationFrame(() => {
      document
        .getElementById(`schedule-item-${focusTaskId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [focusTaskId, localTasks, table])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="mb-2 flex flex-wrap items-center gap-2 border-y py-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDepDialogOpen(true)}
          disabled={localTasks.length < 2}
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
              onClick={() => setRowSelection({})}
            >
              <IconX className="size-4" />
              Clear
            </Button>
          </>
        )}
      </div>

      <div className="rounded-md border flex-1 overflow-x-auto -mx-2 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as { className?: string } | undefined
                    return (
                      <TableHead key={header.id} className={meta?.className}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No schedule items yet. Click &quot;New Schedule Item&quot; to
                    get started.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    id={`schedule-item-${row.original.id}`}
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={cn(
                      row.getIsSelected() && "bg-muted/60",
                      row.original.id === focusTaskId &&
                        "bg-primary/5 outline outline-2 outline-primary/30"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as { className?: string } | undefined
                      return (
                        <TableCell key={cell.id} className={meta?.className}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 px-1">
        <span className="text-xs text-muted-foreground">
          {table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
            1}
          -
          {Math.min(
            (table.getState().pagination.pageIndex + 1) *
              table.getState().pagination.pageSize,
            localTasks.length
          )}{" "}
          of {localTasks.length} items
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(val) => table.setPageSize(Number(val))}
          >
            <SelectTrigger className="h-7 w-[70px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      <ScheduleItemFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={editingTask}
        allTasks={localTasks}
        dependencies={dependencies}
        exceptions={exceptions}
        assigneeOptions={assigneeOptions}
      />

      <DependencyDialog
        open={depDialogOpen}
        onOpenChange={setDepDialogOpen}
        projectId={projectId}
        tasks={localTasks}
        dependencies={dependencies}
      />

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
