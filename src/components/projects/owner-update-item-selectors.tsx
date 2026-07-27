"use client"

import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  OwnerUpdateScheduleSelection,
  OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"

function mergeScheduleItems(
  selected: readonly OwnerUpdateScheduleSelection[],
  available: readonly OwnerUpdateScheduleSelection[]
): readonly OwnerUpdateScheduleSelection[] {
  const byId = new Map(
    [...selected, ...available].map((item) => [item.id, item])
  )
  return [...byId.values()]
}

function mergeTodoItems(
  selected: readonly OwnerUpdateTodoSelection[],
  available: readonly OwnerUpdateTodoSelection[]
): readonly OwnerUpdateTodoSelection[] {
  const byId = new Map(
    [...selected, ...available].map((item) => [item.id, item])
  )
  return [...byId.values()]
}

function SelectionCount({
  selected,
  total,
}: {
  readonly selected: number
  readonly total: number
}): React.ReactElement {
  return (
    <span className="text-xs text-muted-foreground">
      {selected} selected · {total} available
    </span>
  )
}

export function OwnerUpdateScheduleSelector({
  title,
  icon,
  available,
  selected,
  setSelected,
}: {
  readonly title: string
  readonly icon: React.ReactNode
  readonly available: readonly OwnerUpdateScheduleSelection[]
  readonly selected: readonly OwnerUpdateScheduleSelection[]
  readonly setSelected: React.Dispatch<
    React.SetStateAction<readonly OwnerUpdateScheduleSelection[]>
  >
}): React.ReactElement {
  const choices = mergeScheduleItems(selected, available)
  const selectedIds = new Set(selected.map((item) => item.id))

  function toggle(item: OwnerUpdateScheduleSelection, checked: boolean): void {
    setSelected((current) =>
      checked
        ? [...current, item]
        : current.filter((candidate) => candidate.id !== item.id)
    )
  }

  function updateSelected(
    id: string,
    field: "title" | "notes",
    value: string
  ): void {
    setSelected((current) =>
      current.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    )
  }

  return (
    <section className="border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <SelectionCount selected={selected.length} total={choices.length} />
      </div>
      {choices.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No matching schedule items for this reporting period.
        </p>
      ) : (
        <div className="mt-3 divide-y border-y">
          {choices.map((item) => {
            const checked = selectedIds.has(item.id)
            const edited = selected.find(
              (candidate) => candidate.id === item.id
            )
            return (
              <div key={item.id} className="py-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggle(item, value === true)
                    }
                    aria-label={`Include ${item.title}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.startDate} – {item.endDate} ·{" "}
                      {item.percentComplete}% complete
                      {item.assignedTo ? ` · ${item.assignedTo}` : ""}
                    </span>
                  </span>
                </label>
                {checked && (
                  <div className="ml-7 mt-3 grid gap-2 md:grid-cols-2">
                    <Input
                      value={edited?.title ?? item.title}
                      onChange={(event) =>
                        updateSelected(
                          item.id,
                          "title",
                          event.currentTarget.value
                        )
                      }
                      aria-label={`Owner-facing title for ${item.title}`}
                    />
                    <Input
                      value={edited?.notes ?? ""}
                      onChange={(event) =>
                        updateSelected(
                          item.id,
                          "notes",
                          event.currentTarget.value
                        )
                      }
                      placeholder="Optional owner-facing note"
                      aria-label={`Owner-facing note for ${item.title}`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function OwnerUpdateTodoSelector({
  available,
  selected,
  setSelected,
}: {
  readonly available: readonly OwnerUpdateTodoSelection[]
  readonly selected: readonly OwnerUpdateTodoSelection[]
  readonly setSelected: React.Dispatch<
    React.SetStateAction<readonly OwnerUpdateTodoSelection[]>
  >
}): React.ReactElement {
  const choices = mergeTodoItems(selected, available)
  const selectedIds = new Set(selected.map((item) => item.id))

  function toggle(item: OwnerUpdateTodoSelection, checked: boolean): void {
    setSelected((current) =>
      checked
        ? [...current, item]
        : current.filter((candidate) => candidate.id !== item.id)
    )
  }

  function updateSelected(
    id: string,
    field: "title" | "description" | "notes",
    value: string
  ): void {
    setSelected((current) =>
      current.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    )
  }

  return (
    <section className="border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">To-dos</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Due during the reporting period or the following seven days.
          </p>
        </div>
        <SelectionCount selected={selected.length} total={choices.length} />
      </div>
      {choices.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No matching to-dos for this period.
        </p>
      ) : (
        <div className="mt-3 divide-y border-y">
          {choices.map((item) => {
            const checked = selectedIds.has(item.id)
            const edited = selected.find(
              (candidate) => candidate.id === item.id
            )
            return (
              <div key={item.id} className="py-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggle(item, value === true)
                    }
                    aria-label={`Include ${item.title}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <Badge variant="outline">
                        {item.timing === "upcoming"
                          ? "Upcoming week"
                          : "Reporting period"}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.status}
                      {item.dueDate ? ` · Due ${item.dueDate}` : ""}
                      {item.assigneeName
                        ? ` · ${item.assigneeName}`
                        : item.companyName
                          ? ` · ${item.companyName}`
                          : ""}
                    </span>
                  </span>
                </label>
                {checked && (
                  <div className="ml-7 mt-3 grid gap-2">
                    <Input
                      value={edited?.title ?? item.title}
                      onChange={(event) =>
                        updateSelected(
                          item.id,
                          "title",
                          event.currentTarget.value
                        )
                      }
                      aria-label={`Owner-facing title for ${item.title}`}
                    />
                    <div className="grid gap-2 md:grid-cols-2">
                      <Textarea
                        value={edited?.description ?? item.description}
                        onChange={(event) =>
                          updateSelected(
                            item.id,
                            "description",
                            event.currentTarget.value
                          )
                        }
                        className="min-h-20"
                        placeholder="Owner-facing description"
                        aria-label={`Owner-facing description for ${item.title}`}
                      />
                      <Textarea
                        value={edited?.notes ?? item.notes}
                        onChange={(event) =>
                          updateSelected(
                            item.id,
                            "notes",
                            event.currentTarget.value
                          )
                        }
                        className="min-h-20"
                        placeholder="Optional update note"
                        aria-label={`Owner-facing note for ${item.title}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
