"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconArchive,
  IconEdit,
  IconSearch,
} from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import {
  setProjectTodoStatus,
  type ProjectOperationItem,
} from "@/app/actions/project-operations"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectTodoEditDialog } from "@/components/projects/project-todo-edit-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  isArchivedProjectTodoStatus,
  isCompletedProjectTodoStatus,
  normalizeProjectTodoStatus,
  projectTodoStatusLabel,
  projectTodoTypeLabel,
  type ProjectTodoStatus,
} from "@/lib/project-todos"
import { normalizeWorkCalendarSearch } from "@/lib/work-calendar"

type TodoFilter = "active" | "completed" | "archived" | "all"

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function sourceLabel(item: ProjectOperationItem): string {
  if (item.sourceSystem === "buildertrend") return "Buildertrend import"
  if (item.sourceSystem === "compass") return "Compass"
  if (item.sourceSystem === "sage") return "Sage"
  return item.sourceSystem
}

function todoMatches(item: ProjectOperationItem, query: string): boolean {
  const normalizedQuery = normalizeWorkCalendarSearch(query)
  if (!normalizedQuery) return true

  return normalizeWorkCalendarSearch(
    [
      item.title,
      item.description,
      item.sourceRecordNumber,
      item.assigneeName,
      item.companyName,
      item.status,
      item.priority,
      projectTodoTypeLabel(item.sourceRecordType),
      sourceLabel(item),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
}

function itemMatchesFilter(
  item: ProjectOperationItem,
  filter: TodoFilter
): boolean {
  if (filter === "all") return true
  if (filter === "archived") {
    return isArchivedProjectTodoStatus(item.status)
  }
  if (filter === "completed") {
    return (
      !isArchivedProjectTodoStatus(item.status) &&
      isCompletedProjectTodoStatus(item.status)
    )
  }
  return (
    !isArchivedProjectTodoStatus(item.status) &&
    !isCompletedProjectTodoStatus(item.status)
  )
}

function initialFilterForItem(
  item: ProjectOperationItem | null
): TodoFilter {
  if (!item) return "active"
  if (isArchivedProjectTodoStatus(item.status)) return "archived"
  if (isCompletedProjectTodoStatus(item.status)) return "completed"
  return "active"
}

function StatusControl({
  projectId,
  item,
}: {
  readonly projectId: string
  readonly item: ProjectOperationItem
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const status = normalizeProjectTodoStatus(item.status)

  function changeStatus(nextStatus: ProjectTodoStatus): void {
    setError(null)
    startTransition(async () => {
      const result = await setProjectTodoStatus(
        projectId,
        item.id,
        nextStatus,
        item.updatedAt
      )
      if (!result.success) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div>
      <label className="sr-only" htmlFor={`todo-status-control-${item.id}`}>
        Status for {item.title}
      </label>
      <select
        id={`todo-status-control-${item.id}`}
        value={status}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value
          if (
            value === "open" ||
            value === "in_progress" ||
            value === "blocked" ||
            value === "complete"
          ) {
            changeStatus(value)
          }
        }}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      >
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="complete">Complete</option>
      </select>
      {error && (
        <p className="mt-1 max-w-56 text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}

export function ProjectTodosView({
  projectId,
  projectLabel,
  items,
  initialItemId,
  assigneeOptions,
  canManage,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly items: readonly ProjectOperationItem[]
  readonly initialItemId: string | null
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly canManage: boolean
}): React.ReactElement {
  const initialItem =
    items.find((item) => item.id === initialItemId) ?? null
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<TodoFilter>(
    initialFilterForItem(initialItem)
  )
  const [editingItem, setEditingItem] =
    React.useState<ProjectOperationItem | null>(null)
  const counts = React.useMemo(
    () => ({
      active: items.filter((item) => itemMatchesFilter(item, "active")).length,
      completed: items.filter((item) => itemMatchesFilter(item, "completed"))
        .length,
      archived: items.filter((item) => itemMatchesFilter(item, "archived"))
        .length,
      all: items.length,
    }),
    [items]
  )
  const visibleItems = items.filter(
    (item) => itemMatchesFilter(item, filter) && todoMatches(item, query)
  )

  React.useEffect(() => {
    if (!initialItemId) return
    const element = document.getElementById(`todo-${initialItemId}`)
    if (!element) return
    element.scrollIntoView({ behavior: "smooth", block: "center" })
    element.focus({ preventScroll: true })
  }, [initialItemId, filter])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{projectLabel}</p>
          <h1 className="text-2xl font-semibold tracking-tight">To-dos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit, assign, complete, or archive project work regardless of
            whether it began in Compass, Buildertrend, or Sage.
          </p>
        </div>
        {canManage && (
          <ProjectTaskCreateButton
            projectId={projectId}
            sourceLabel="Project"
            sourceRecordId={null}
            sourceRecordNumber={null}
            sourceHref={null}
            defaultTitle=""
            defaultDescription={null}
            defaultAssigneeName={null}
            defaultCompanyName={null}
            defaultDueDate={null}
            defaultPriority="normal"
            assigneeOptions={assigneeOptions}
          />
        )}
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xl">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, assignee, company, status, or source…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["active", "Active"],
              ["completed", "Completed"],
              ["archived", "Archived"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {label} {counts[value]}
            </Button>
          ))}
        </div>
      </div>

      {initialItemId && !initialItem && (
        <p className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
          The linked to-do was not found in this project.
        </p>
      )}

      <section className="divide-y border-y">
        {visibleItems.length > 0 ? (
          visibleItems.map((item) => {
            const focused = item.id === initialItemId
            const archived = isArchivedProjectTodoStatus(item.status)
            return (
              <article
                id={`todo-${item.id}`}
                key={item.id}
                tabIndex={-1}
                data-focused={focused ? "true" : "false"}
                className={cn(
                  "grid gap-3 px-2 py-4 outline-none transition-colors sm:grid-cols-[minmax(0,1fr)_auto]",
                  focused &&
                    "border-l-4 border-l-primary bg-primary/5 ring-2 ring-inset ring-primary/20"
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{item.title}</h2>
                    <Badge variant="outline">
                      {projectTodoTypeLabel(item.sourceRecordType)}
                    </Badge>
                    <Badge variant="secondary">
                      {projectTodoStatusLabel(item.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {sourceLabel(item)}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.sourceRecordNumber ?? "Compass to-do"}
                    {item.assigneeName ? ` · ${item.assigneeName}` : ""}
                    {item.companyName ? ` · ${item.companyName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div className="mr-2 text-sm text-muted-foreground sm:text-right">
                    <p>{formatDate(item.dueDate ?? item.startDate)}</p>
                    <p className="mt-1 capitalize">{item.priority} priority</p>
                  </div>
                  {canManage && !archived && (
                    <StatusControl projectId={projectId} item={item} />
                  )}
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingItem(item)}
                    >
                      {archived ? (
                        <IconArchive className="size-4" />
                      ) : (
                        <IconEdit className="size-4" />
                      )}
                      {archived ? "Review" : "Edit"}
                    </Button>
                  )}
                </div>
              </article>
            )
          })
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No to-dos match this view.
          </p>
        )}
      </section>

      {editingItem && canManage && (
        <ProjectTodoEditDialog
          key={`${editingItem.id}-${editingItem.updatedAt}`}
          projectId={projectId}
          item={editingItem}
          assigneeOptions={assigneeOptions}
          open
          onOpenChange={(open) => {
            if (!open) setEditingItem(null)
          }}
        />
      )}
    </div>
  )
}
