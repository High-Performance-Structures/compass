"use client"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  IconAlertTriangle,
  IconPencil,
  IconPlus,
  IconChevronRight,
  IconChevronDown,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { conflictSummary, type ScheduleConflict } from "@/lib/schedule/conflicts"
import type { DisplayItem } from "@/lib/schedule/gantt-transform"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { scheduleItemAssigneeNames } from "@/lib/schedule/assignees"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { scheduleItemHref } from "@/lib/work-calendar"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import { projectScheduleLabel } from "@/lib/schedule/project-scope"
import { scheduleItemTimeLabel } from "@/lib/schedule/item-time"

/** The item list beside the Gantt chart; each row is level with its bar. */
export function GanttTaskTable({
  displayItems,
  togglePhase,
  projectById,
  multipleProjects,
  conflicts,
  focusedTaskId,
  focusTaskOnTimeline,
  phaseGrouping,
  groupByCrew,
  assigneeOptions,
  projectId,
  onEditTask,
  onAddTask,
}: {
  readonly displayItems: readonly DisplayItem[]
  readonly togglePhase: (phase: string) => void
  readonly projectById: ReadonlyMap<string, ScheduleProjectData>
  readonly multipleProjects: boolean
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly focusedTaskId: string | null
  readonly focusTaskOnTimeline: (task: ScheduleTaskData) => void
  readonly phaseGrouping: boolean
  readonly groupByCrew: boolean
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly projectId: string | null
  readonly onEditTask: (task: ScheduleTaskData) => void
  readonly onAddTask: () => void
}) {
  // The list's own scroll area scrolls both ways: a minimum width keeps titles
  // readable when the panel is narrow, and the horizontal scrollbar stays at
  // the bottom of the visible panel instead of the end of a long table.
  return (
    <Table className="table-fixed min-w-[30rem]" containerClassName="overflow-visible">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="h-[85px]">
          <TableHead className="text-xs">Title</TableHead>
          <TableHead className="text-xs w-[80px]">Start</TableHead>
          <TableHead className="text-xs w-[52px]">Days</TableHead>
          <TableHead className="text-xs w-[52px]">Done</TableHead>
          <TableHead className="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {displayItems.map((item) => {
          if (item.type === "phase-header") {
            const { phase, group, collapsed } = item
            return (
              <TableRow
                key={`phase-${phase}`}
                className="h-[48px] max-h-[48px] bg-muted/40 cursor-pointer hover:bg-muted/60"
                onClick={() => togglePhase(phase)}
              >
                <TableCell
                  colSpan={collapsed ? 5 : 1}
                  className="h-[48px] py-0 text-xs font-medium"
                >
                  <span className="flex items-center gap-1">
                    {collapsed
                      ? <IconChevronRight className="size-3.5 shrink-0" />
                      : <IconChevronDown className="size-3.5 shrink-0" />}
                    {group.label}
                    <span className="text-muted-foreground font-normal ml-1">
                      ({group.tasks.length})
                    </span>
                    {collapsed && (
                      <span className="text-muted-foreground font-normal ml-auto text-xs">
                        {group.startDate.slice(5)} – {group.endDate.slice(5)}
                      </span>
                    )}
                  </span>
                </TableCell>
                {!collapsed && (
                  <>
                    <TableCell className="h-[48px] py-0 text-xs text-muted-foreground">
                      {group.startDate.slice(5)}
                    </TableCell>
                    <TableCell className="h-[48px] py-0 text-xs" />
                    <TableCell className="h-[48px] py-0 text-xs" />
                    <TableCell className="h-[48px] py-0" />
                  </>
                )}
              </TableRow>
            )
          }

          const { task } = item
          const taskProject = projectById.get(task.projectId)
          return (
            <TableRow
              key={task.id}
              data-schedule-task-id={task.id}
              className={cn(
                "h-[48px] max-h-[48px] cursor-pointer",
                focusedTaskId === task.id && "bg-accent"
              )}
              onClick={() => focusTaskOnTimeline(task)}
              title="Show this item on the timeline"
            >
              <TableCell className="h-[48px] py-0 text-xs">
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5",
                    (phaseGrouping || groupByCrew) && "pl-4"
                  )}
                >
                  {multipleProjects && taskProject && (
                    <span
                      className="inline-flex max-w-[104px] shrink-0 items-center gap-1 rounded-sm bg-muted px-1 py-0.5 text-xs font-medium"
                      title={projectScheduleLabel(taskProject)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: taskProject.color }}
                      />
                      <span className="truncate">
                        {taskProject.projectNumber ?? taskProject.name}
                      </span>
                    </span>
                  )}
                  {conflicts.has(task.id) ? (
                    <span
                      className="shrink-0 text-destructive"
                      title={(conflicts.get(task.id) ?? [])
                        .map((conflict) =>
                          conflictSummary(conflict, (id) => {
                            const other = projectById.get(id)
                            return other ? projectScheduleLabel(other) : "another job"
                          })
                        )
                        .join("\n")}
                    >
                      <IconAlertTriangle className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Crew double-booked</span>
                    </span>
                  ) : null}
                  {/* Two lines fit the 48px row, which must stay level with its bar. */}
                  <span
                    className="line-clamp-2 break-words leading-tight"
                    title={scheduleItemTimeLabel(task) ? `${task.title} · ${scheduleItemTimeLabel(task)}` : task.title}
                  >
                    {task.title}
                  </span>
                </span>
              </TableCell>
              <TableCell
                className="h-[48px] py-0 text-xs text-muted-foreground"
                title={scheduleItemTimeLabel(task) ?? undefined}
              >
                {task.startDate.slice(5)}
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs">
                {task.workdays}
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs tabular-nums">
                {effectivePercentComplete(task.status, task.percentComplete)}%
              </TableCell>
              <TableCell className="h-[48px] py-0">
                <div
                  className="flex items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ProjectTaskCreateButton
                    compact
                    projectId={task.projectId}
                    sourceLabel="Schedule item"
                    sourceRecordId={task.id}
                    sourceRecordNumber={null}
                    sourceHref={scheduleItemHref(task.projectId, task.id)}
                    defaultTitle={`Follow up: ${task.title}`}
                    defaultDescription={`${task.phase} schedule item.`}
                    defaultAssigneeName={scheduleItemAssigneeNames(task)[0] ?? null}
                    defaultCompanyName={null}
                    defaultDueDate={task.endDateCalculated}
                    defaultPriority={task.isCriticalPath ? "high" : "normal"}
                    defaultTaskType="schedule_task"
                    assigneeOptions={assigneeOptions}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Edit ${task.title}`}
                    onClick={() => onEditTask(task)}
                  >
                    <IconPencil className="size-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
        {projectId && (
          <TableRow>
            <TableCell colSpan={5} className="py-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs w-full justify-start"
                onClick={() => onAddTask()}
              >
                <IconPlus className="size-3 mr-1" />
                Add Schedule Item
              </Button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
