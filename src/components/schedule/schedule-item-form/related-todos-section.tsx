"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { getScheduleTaskTodos } from "@/app/actions/project-todos"
import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { projectTodoHref, scheduleItemHref } from "@/lib/work-calendar"

/** Project to-dos linked to the schedule item being edited. */
export function RelatedTodosSection({
  open,
  projectId,
  editingTask,
  assigneeOptions,
}: {
  readonly open: boolean
  readonly projectId: string
  readonly editingTask: ScheduleTaskData
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
}) {
  const [linkedTodos, setLinkedTodos] = useState<
    readonly ProjectTodoItem[]
  >([])
  const [linkedTodosLoading, setLinkedTodosLoading] = useState(false)
  const [linkedTodosError, setLinkedTodosError] = useState<string | null>(null)
  const [linkedTodosRefreshKey, setLinkedTodosRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!open || !editingTask) {
      setLinkedTodos([])
      setLinkedTodosLoading(false)
      setLinkedTodosError(null)
      return () => {
        cancelled = true
      }
    }

    setLinkedTodosLoading(true)
    setLinkedTodosError(null)
    void getScheduleTaskTodos(projectId, editingTask.id)
      .then((todos) => {
        if (!cancelled) setLinkedTodos(todos)
      })
      .catch((error: unknown) => {
        console.error("Unable to load linked schedule to-dos", error)
        if (!cancelled) {
          setLinkedTodosError("Related to-dos could not be loaded.")
        }
      })
      .finally(() => {
        if (!cancelled) setLinkedTodosLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editingTask, linkedTodosRefreshKey, open, projectId])

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Related to-dos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Related to-dos</h3>
            {!linkedTodosLoading && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {linkedTodos.length}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These stay in the existing Compass project to-do list and link back here.
          </p>
        </div>
        <ProjectTaskCreateButton
          projectId={projectId}
          sourceLabel="Schedule item"
          sourceRecordId={editingTask.id}
          sourceRecordNumber={null}
          sourceHref={scheduleItemHref(projectId, editingTask.id)}
          defaultTitle={`Follow up: ${editingTask.title}`}
          defaultDescription={`${editingTask.phase} schedule item.`}
          defaultAssigneeName={editingTask.assignedTo}
          defaultCompanyName={null}
          defaultDueDate={editingTask.endDateCalculated}
          defaultPriority={editingTask.isCriticalPath ? "high" : "normal"}
          defaultTaskType="schedule_task"
          assigneeOptions={assigneeOptions}
          onCreated={() =>
            setLinkedTodosRefreshKey((current) => current + 1)
          }
        />
      </div>

      {linkedTodosLoading ? (
        <p className="border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
          Loading related to-dos…
        </p>
      ) : linkedTodosError ? (
        <p className="border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive">
          {linkedTodosError}
        </p>
      ) : linkedTodos.length === 0 ? (
        <p className="border border-dashed px-3 py-3 text-xs text-muted-foreground">
          No to-dos are linked to this schedule item yet.
        </p>
      ) : (
        <div className="divide-y border">
          {linkedTodos.map((todo) => (
            <div
              key={todo.id}
              className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <Link
                  href={projectTodoHref(projectId, todo.id)}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {todo.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {todo.sourceRecordNumber ?? "Compass to-do"}
                  {todo.assigneeName || todo.companyName
                    ? ` · ${todo.assigneeName ?? todo.companyName}`
                    : ""}
                  {todo.dueDate
                    ? ` · Due ${format(parseISO(todo.dueDate), "MMM d, yyyy")}`
                    : " · No due date"}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {todo.status.replaceAll("_", " ")}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link
        href={`/dashboard/projects/${encodeURIComponent(projectId)}/todos`}
        className="inline-flex text-xs font-medium text-primary hover:underline"
      >
        Open all project to-dos
      </Link>
    </section>
  )
}
