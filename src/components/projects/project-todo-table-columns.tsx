"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { recordSelectionColumn } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import { formatDate } from "@/lib/format"
import { projectTodoStatusLabel, projectTodoTypeLabel } from "@/lib/project-todos"
import { scheduleItemHref } from "@/lib/work-calendar"

export function projectTodoColumns({
  projectId,
  canManage,
  developerModeEnabled,
  onOpen,
}: {
  readonly projectId: string
  readonly canManage: boolean
  readonly developerModeEnabled: boolean
  readonly onOpen: (item: ProjectTodoItem) => void
}): ColumnDef<ProjectTodoItem>[] {
  return [
    ...(canManage ? [recordSelectionColumn<ProjectTodoItem>((item) => item.title)] : []),
    {
      accessorKey: "title",
      header: "Name",
      size: 210,
      cell: ({ row: { original: item } }) => (
        <div className="min-w-40 space-y-1">
          <button
            type="button"
            className="break-words text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpen(item)}
          >
            {item.title}
          </button>
          <p className="text-xs text-muted-foreground">
            {item.sourceRecordNumber ?? projectTodoTypeLabel(item.sourceRecordType)}
            {developerModeEnabled ? ` · ${item.sourceSystem}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "description",
      accessorFn: (item) => item.description || undefined,
      header: "Description",
      size: 250,
      cell: ({ row }) => (
        <p className="min-w-40 break-words text-muted-foreground">
          {row.original.description || "—"}
        </p>
      ),
    },
    {
      id: "status",
      accessorFn: (item) => projectTodoStatusLabel(item.status),
      header: "Status",
      size: 110,
    },
    {
      id: "assignedTo",
      accessorFn: (item) => item.assigneeName || item.companyName || undefined,
      header: "Assigned to",
      size: 140,
      cell: ({ row: { original: item } }) => (
        <div className="space-y-1">
          <p>{item.assigneeName ?? item.companyName ?? "Unassigned"}</p>
          {item.assigneeName && item.companyName && (
            <p className="text-xs text-muted-foreground">{item.companyName}</p>
          )}
        </div>
      ),
    },
    {
      id: "dueDate",
      accessorFn: (item) => item.dueDate || undefined,
      header: "Due date",
      size: 120,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(row.original.dueDate, "medium", "No due date")}
        </span>
      ),
    },
    {
      id: "author",
      accessorFn: (item) => item.authorName || undefined,
      header: "Author",
      size: 125,
      cell: ({ row }) => row.original.authorName ?? "—",
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: "Priority",
      size: 90,
      cell: ({ row }) => <span className="capitalize">{row.original.priority}</span>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      size: 140,
      cell: ({ row: { original: item } }) => (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen(item)}
            aria-label={`${canManage && item.actions.canEdit ? "Edit" : "View"} ${item.title}`}
          >
            {canManage && item.actions.canEdit ? "Edit" : "View"}
          </Button>
          {item.linkedScheduleTaskId && (
            <Link
              href={scheduleItemHref(projectId, item.linkedScheduleTaskId)}
              className="text-xs text-primary hover:underline"
            >
              View linked schedule item
            </Link>
          )}
        </div>
      ),
    },
  ]
}
