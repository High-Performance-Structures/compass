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
} from "@tabler/icons-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TaskFormDialog } from "./task-form-dialog"
import { DependencyDialog } from "./dependency-dialog"
import { deleteTask } from "@/app/actions/schedule"
import type {
  ScheduleTaskData,
  TaskDependencyData,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format, parseISO } from "date-fns"

interface ScheduleListViewProps {
  projectId: string
  tasks: ScheduleTaskData[]
  dependencies: TaskDependencyData[]
}

function StatusDot({ task }: { task: ScheduleTaskData }) {
  let color = "bg-gray-400"
  if (task.status === "COMPLETE") color = "bg-green-500"
  else if (task.status === "IN_PROGRESS") color = "bg-blue-500"
  else if (task.status === "BLOCKED") color = "bg-red-500"
  else if (task.isCriticalPath) color = "bg-orange-500"
  return <span className={`inline-block size-2.5 rounded-full ${color}`} />
}

function ProgressRing({
  percent,
  size = 28,
}: {
  percent: number
  size?: number
}) {
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted-foreground/20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary"
        />
      </svg>
      <span className="absolute text-[9px] font-medium">
        {percent}%
      </span>
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
}: ScheduleListViewProps) {
  const router = useRouter()
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(null)
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [localTasks, setLocalTasks] = useState(tasks)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setLocalTasks(tasks)
  }, [tasks])

  const handleDelete = useCallback(
    async (taskId: string) => {
      const result = await deleteTask(taskId)
      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    },
    [router]
  )

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
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
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
            <StatusDot task={row.original} />
            <span className="font-medium text-sm truncate max-w-[150px] sm:max-w-[200px]">
              {row.original.title}
            </span>
          </div>
        ),
      },
      {
        id: "complete",
        header: "Complete",
        cell: ({ row }) => (
          <ProgressRing percent={row.original.percentComplete} />
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
        header: "Assigned To",
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
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                setEditingTask(row.original)
                setTaskFormOpen(true)
              }}
            >
              <IconPencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => handleDelete(row.original.id)}
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ),
        size: 80,
      },
    ],
    [handleDelete]
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-2 mb-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDepDialogOpen(true)}
          disabled={localTasks.length < 2}
        >
          <IconLink className="size-4 mr-1" />
          Add Dependency
        </Button>
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
                    No tasks yet. Click &quot;New Schedule Item&quot; to get started.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
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

      <TaskFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={editingTask}
      />

      <DependencyDialog
        open={depDialogOpen}
        onOpenChange={setDepDialogOpen}
        projectId={projectId}
        tasks={localTasks}
        dependencies={dependencies}
      />
    </div>
  )
}
