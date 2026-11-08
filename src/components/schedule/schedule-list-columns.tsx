"use client"

import type * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { IconAlertTriangle, IconPencil, IconTrash } from "@tabler/icons-react"

import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ScheduleAssigneeStack } from "@/components/schedule/schedule-assignee-stack"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { formatDate } from "@/lib/format"
import { getScheduleItemDisplayColor, type DisplayColorPalette } from "@/lib/schedule/appearance"
import { scheduleItemAssigneeNames } from "@/lib/schedule/assignees"
import { conflictSummary, type ScheduleConflict } from "@/lib/schedule/conflicts"
import { scheduleItemTimeLabel } from "@/lib/schedule/item-time"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import { projectScheduleLabel, type ScheduleProjectData } from "@/lib/schedule/project-scope"
import type { ScheduleListColumn } from "@/lib/schedule/saved-views"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { scheduleItemHref } from "@/lib/work-calendar"

/** "Oct 30, 2026"; an unreadable value is shown as stored, as before. */
function dateLabel(value: string): string {
  return formatDate(value, "medium", value)
}

function ProgressValue({ percent }: { readonly percent: number }): React.ReactElement {
  return (
    <div className="w-12">
      <span className="block text-xs font-medium tabular-nums">{percent}%</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/**
 * The schedule list sheet's columns ("schedule.list" in the list sheet
 * registry). Columns the schedule's own view hides (saved view, URL) are left
 * out; the project column only shows when several jobs are on the schedule.
 */
export function scheduleListColumns({
  visibleColumns,
  multipleProjects,
  projectById,
  conflicts,
  palette,
  assigneeOptions,
  onEdit,
  onDelete,
}: {
  readonly visibleColumns: readonly ScheduleListColumn[]
  readonly multipleProjects: boolean
  readonly projectById: ReadonlyMap<string, ScheduleProjectData>
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly palette: DisplayColorPalette
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly onEdit: (task: ScheduleTaskData) => void
  readonly onDelete: (task: ScheduleTaskData) => void
}): ColumnDef<ScheduleTaskData>[] {
  const shows = (column: ScheduleListColumn): boolean =>
    visibleColumns.includes(column) && (column !== "project" || multipleProjects)

  const optional: readonly (readonly [ScheduleListColumn, ColumnDef<ScheduleTaskData>])[] = [
    [
      "project",
      {
        id: "project",
        accessorFn: (task) => {
          const project = projectById.get(task.projectId)
          return project ? project.projectNumber ?? project.name : undefined
        },
        header: "Project",
        cell: ({ row }) => {
          const project = projectById.get(row.original.projectId)
          return project ? (
            <div className="flex max-w-[180px] items-center gap-1.5 text-xs" title={projectScheduleLabel(project)}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
              <span className="truncate">{project.projectNumber ?? project.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        },
      },
    ],
    [
      "complete",
      {
        id: "complete",
        accessorFn: (task) => effectivePercentComplete(task.status, task.percentComplete),
        header: "Complete",
        size: 70,
        cell: ({ row }) => (
          <ProgressValue percent={effectivePercentComplete(row.original.status, row.original.percentComplete)} />
        ),
      },
    ],
    [
      "phase",
      {
        accessorKey: "phase",
        header: "Phase",
        cell: ({ row }) => (
          <span className="inline-block max-w-[80px] truncate text-xs text-muted-foreground">{row.original.phase}</span>
        ),
      },
    ],
    [
      "duration",
      {
        id: "duration",
        accessorFn: (task) => task.workdays,
        header: "Duration",
        size: 80,
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.workdays} {row.original.workdays === 1 ? "day" : "days"}
          </span>
        ),
      },
    ],
    [
      "startDate",
      {
        accessorKey: "startDate",
        header: "Start",
        cell: ({ row }) => {
          const time = scheduleItemTimeLabel(row.original)
          return (
            <span className="text-xs text-muted-foreground">
              {dateLabel(row.original.startDate)}
              {time ? <span className="block">{time}</span> : null}
            </span>
          )
        },
      },
    ],
    [
      "endDateCalculated",
      {
        accessorKey: "endDateCalculated",
        header: "End",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{dateLabel(row.original.endDateCalculated)}</span>
        ),
      },
    ],
    [
      "assignedTo",
      {
        id: "assignedTo",
        accessorFn: (task) => scheduleItemAssigneeNames(task).join(", ") || undefined,
        header: "Responsible",
        cell: ({ row }) => <ScheduleAssigneeStack names={scheduleItemAssigneeNames(row.original)} />,
      },
    ],
  ]

  return [
    {
      id: "select",
      enableSorting: false,
      size: 32,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
          aria-label="Select all schedule items"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          aria-label={`Select ${row.original.title}`}
        />
      ),
    },
    {
      id: "idNum",
      // The item's place in the schedule's own order; sorting by it restores that order.
      accessorFn: (_task, index) => index + 1,
      header: "#",
      size: 40,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.index + 1}</span>,
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const task = row.original
        const taskConflicts = conflicts.get(task.id)
        return (
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getScheduleItemDisplayColor(task, palette) }}
            />
            <button
              type="button"
              className="max-w-[150px] truncate text-left text-sm font-medium hover:underline sm:max-w-[200px]"
              onClick={() => onEdit(task)}
              aria-label={`Edit ${task.title}`}
              title={`Edit ${task.title}`}
            >
              {task.title}
            </button>
            {taskConflicts ? (
              <span
                className="shrink-0 text-destructive"
                title={taskConflicts
                  .map((conflict) =>
                    conflictSummary(conflict, (id) => {
                      const other = projectById.get(id)
                      return other ? projectScheduleLabel(other) : "another job"
                    })
                  )
                  .join("\n")}
              >
                <IconAlertTriangle className="size-4" aria-hidden="true" />
                <span className="sr-only">Crew double-booked</span>
              </span>
            ) : null}
          </div>
        )
      },
    },
    ...optional.filter(([column]) => shows(column)).map(([, definition]) => definition),
    {
      id: "actions",
      size: 110,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <ProjectTaskCreateButton
            compact
            projectId={row.original.projectId}
            sourceLabel="Schedule item"
            sourceRecordId={row.original.id}
            sourceRecordNumber={null}
            sourceHref={scheduleItemHref(row.original.projectId, row.original.id)}
            defaultTitle={`Follow up: ${row.original.title}`}
            defaultDescription={`${row.original.phase} schedule item.`}
            defaultAssigneeName={scheduleItemAssigneeNames(row.original)[0] ?? null}
            defaultCompanyName={null}
            defaultDueDate={row.original.endDateCalculated}
            defaultPriority={row.original.isCriticalPath ? "high" : "normal"}
            defaultTaskType="schedule_task"
            assigneeOptions={assigneeOptions}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onEdit(row.original)}
            aria-label={`Edit ${row.original.title}`}
            title="Edit schedule item"
          >
            <IconPencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onDelete(row.original)}
            aria-label={`Delete ${row.original.title}`}
            title="Delete schedule item"
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ]
}
