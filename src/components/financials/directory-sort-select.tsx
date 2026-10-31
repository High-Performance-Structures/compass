"use client"

import type { SortingState } from "@tanstack/react-table"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** The phone sort picker on the client and vendor directories. */

function sortKey(sorting: SortingState): string {
  if (!sorting.length) return "name-asc"
  const s = sorting[0]
  if (s.id === "name") return s.desc ? "name-desc" : "name-asc"
  if (s.id === "createdAt") return s.desc ? "newest" : "oldest"
  return "name-asc"
}

const SORTS: Readonly<Record<string, SortingState>> = {
  "name-asc": [{ id: "name", desc: false }],
  "name-desc": [{ id: "name", desc: true }],
  newest: [{ id: "createdAt", desc: true }],
  oldest: [{ id: "createdAt", desc: false }],
}

export function DirectorySortSelect({
  sorting,
  sortBy,
  triggerClassName,
}: {
  readonly sorting: SortingState
  readonly sortBy: (next: SortingState) => void
  readonly triggerClassName?: string
}) {
  return (
    <Select
      value={sortKey(sorting)}
      onValueChange={(value) => {
        const next = SORTS[value]
        if (next) sortBy(next)
      }}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="name-asc">Name A-Z</SelectItem>
        <SelectItem value="name-desc">Name Z-A</SelectItem>
        <SelectItem value="newest">Newest</SelectItem>
        <SelectItem value="oldest">Oldest</SelectItem>
      </SelectContent>
    </Select>
  )
}
