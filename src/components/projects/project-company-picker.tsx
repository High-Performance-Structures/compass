"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconPlus } from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ProjectCompanyPickerProps = {
  readonly value: string
  readonly options: readonly ProjectTaskAssigneeOption[]
  readonly onValueChange: (value: string) => void
  readonly placeholder?: string
  readonly className?: string
  readonly disabled?: boolean
  readonly clearLabel?: string
}

function normalizeChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function projectCompanyOptions(
  options: readonly ProjectTaskAssigneeOption[]
): readonly string[] {
  const companyByKey = new Map<string, string>()

  for (const option of options) {
    const companyName = option.companyName?.trim() ?? ""
    const key = normalizeChoice(companyName)
    if (!key || companyByKey.has(key)) continue
    companyByKey.set(key, companyName)
  }

  return [...companyByKey.values()].sort((left, right) =>
    left.localeCompare(right)
  )
}

export function ProjectCompanyPicker({
  value,
  options,
  onValueChange,
  placeholder = "Choose company or type a name...",
  className,
  disabled = false,
  clearLabel = "Clear",
}: ProjectCompanyPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalizeChoice(query)
  const normalizedValue = normalizeChoice(value)
  const companies = projectCompanyOptions(options).filter((company) =>
    normalizeChoice(company).includes(normalizedQuery)
  )

  function selectCompany(company: string): void {
    onValueChange(company)
    setQuery("")
    setOpen(false)
  }

  function useTypedCompany(): void {
    const typedCompany = query.trim()
    if (!typedCompany) return

    onValueChange(typedCompany)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between bg-background px-3 text-left font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="min-w-0 truncate">{value || placeholder}</span>
          <IconChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-3rem))] p-0"
      >
        <div className="border-b p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search companies or type a name..."
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {companies.length > 0 ? (
            companies.map((company) => (
              <button
                key={normalizeChoice(company)}
                type="button"
                onClick={() => selectCompany(company)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0 truncate font-medium">{company}</span>
                {normalizeChoice(company) === normalizedValue && (
                  <IconCheck className="size-4 shrink-0" />
                )}
              </button>
            ))
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No matching companies.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onValueChange("")
              setQuery("")
              setOpen(false)
            }}
          >
            {clearLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!query.trim()}
            onClick={useTypedCompany}
          >
            <IconPlus className="size-4" />
            Use typed company
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
