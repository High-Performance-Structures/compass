"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconUserPlus } from "@tabler/icons-react"

import type { ProjectEstimateSignerOption } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ProjectEstimateSignerValue = {
  readonly contactId: string | null
  readonly name: string
  readonly title: string
  readonly email: string
}

type ProjectEstimateSignerPickerProps = {
  readonly value: ProjectEstimateSignerValue
  readonly options: readonly ProjectEstimateSignerOption[]
  readonly onValueChange: (value: ProjectEstimateSignerValue) => void
  readonly placeholder: string
  readonly id?: string
  readonly disabled?: boolean
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function optionMatches(
  option: ProjectEstimateSignerOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true
  return normalize(
    [
      option.name,
      option.title,
      option.companyName,
      option.email,
      option.contactType,
    ]
      .filter((item): item is string => Boolean(item))
      .join(" ")
  ).includes(normalizedQuery)
}

export function ProjectEstimateSignerPicker({
  value,
  options,
  onValueChange,
  placeholder,
  id,
  disabled = false,
}: ProjectEstimateSignerPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalize(query)
  const filtered = options.filter((option) =>
    optionMatches(option, normalizedQuery)
  )

  function choose(option: ProjectEstimateSignerOption): void {
    onValueChange({
      contactId: option.id,
      name: option.name,
      title: option.title ?? "",
      email: option.email ?? "",
    })
    setQuery("")
    setOpen(false)
  }

  function useTypedName(): void {
    const name = query.trim()
    if (!name) return
    onValueChange({ ...value, contactId: null, name })
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between bg-background px-3 text-left font-normal",
            !value.name && "text-muted-foreground"
          )}
        >
          <span className="min-w-0 truncate">{value.name || placeholder}</span>
          <IconChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-3rem))] p-0"
      >
        <div className="border-b p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project contacts or type a name..."
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => choose(option)}
                className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {option.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.title, option.companyName, option.contactType]
                      .filter((item): item is string => Boolean(item))
                      .join(" · ")}
                  </span>
                </span>
                {value.contactId === option.id && (
                  <IconCheck className="mt-0.5 size-4 shrink-0" />
                )}
              </button>
            ))
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No matching project contacts.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onValueChange({ contactId: null, name: "", title: "", email: "" })
              setQuery("")
              setOpen(false)
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!query.trim()}
            onClick={useTypedName}
          >
            <IconUserPlus className="size-4" />
            Use typed name
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
