"use client"

import * as React from "react"
import { IconSearch } from "@tabler/icons-react"

import type { ProjectOperationItem } from "@/app/actions/project-operations"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { normalizeWorkCalendarSearch } from "@/lib/work-calendar"

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function typeLabel(value: string): string {
  if (value === "subcontractor_task") return "Subcontractor"
  if (value === "supplier_task") return "Supplier"
  if (value === "schedule_task") return "Schedule follow-up"
  return "Staff"
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
      typeLabel(item.sourceRecordType),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
}

export function ProjectTodosView({
  projectLabel,
  items,
  initialItemId,
}: {
  readonly projectLabel: string
  readonly items: readonly ProjectOperationItem[]
  readonly initialItemId: string | null
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visibleItems = items.filter((item) => todoMatches(item, query))

  React.useEffect(() => {
    if (!initialItemId) return
    document
      .getElementById(`todo-${initialItemId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [initialItemId])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <header>
        <p className="text-sm text-muted-foreground">{projectLabel}</p>
        <h1 className="text-2xl font-semibold tracking-tight">To-dos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff, subcontractor, supplier, and schedule follow-up work for this
          project.
        </p>
      </header>

      <div className="relative max-w-xl">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, assignee, company, status…"
          className="pl-9"
        />
      </div>

      <section className="divide-y border-y">
        {visibleItems.length > 0 ? (
          visibleItems.map((item) => {
            const focused = item.id === initialItemId
            return (
              <article
                id={`todo-${item.id}`}
                key={item.id}
                tabIndex={focused ? -1 : undefined}
                className={cn(
                  "grid gap-3 px-1 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto]",
                  focused && "bg-primary/5 outline outline-2 outline-primary/30"
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{item.title}</h2>
                    <Badge variant="outline">
                      {typeLabel(item.sourceRecordType)}
                    </Badge>
                    <Badge variant="secondary">{item.status}</Badge>
                  </div>
                  {item.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.sourceRecordNumber ?? "Compass to-do"}
                    {item.assigneeName ? ` · ${item.assigneeName}` : ""}
                    {item.companyName ? ` · ${item.companyName}` : ""}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground sm:text-right">
                  <p>{formatDate(item.dueDate ?? item.startDate)}</p>
                  <p className="mt-1 capitalize">{item.priority} priority</p>
                </div>
              </article>
            )
          })
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No to-dos match this search.
          </p>
        )}
      </section>
    </div>
  )
}
