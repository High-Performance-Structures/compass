import type * as React from "react"
import Link from "next/link"
import { IconSearch } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type StatusOption = {
  readonly value: string
  readonly label: string
}

export function ProjectListFilters({
  baseHref,
  q,
  status,
  from,
  to,
  statusOptions,
  searchPlaceholder,
  resultLabel,
}: {
  readonly baseHref: string
  readonly q: string
  readonly status: string
  readonly from: string
  readonly to: string
  readonly statusOptions: readonly StatusOption[]
  readonly searchPlaceholder: string
  readonly resultLabel: string
}): React.ReactElement {
  return (
    <form
      action={baseHref}
      className="grid gap-2 border-b pb-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_10rem_10rem_auto]"
    >
      <Input
        name="q"
        defaultValue={q}
        placeholder={searchPlaceholder}
        aria-label="Search"
      />
      <select
        name="status"
        defaultValue={status}
        className="h-9 rounded-md border bg-background px-3 text-sm"
        aria-label="Status"
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Input name="from" type="date" defaultValue={from} aria-label="From date" />
      <Input name="to" type="date" defaultValue={to} aria-label="To date" />
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" variant="outline" className="flex-1 lg:flex-none">
          <IconSearch className="size-4" />
          Search
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href={baseHref}>Clear</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
        {resultLabel}
      </p>
    </form>
  )
}
