"use client"

import * as React from "react"
import {
  IconCheck,
  IconChevronDown,
  IconUserPlus,
} from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ProjectAssigneePickerProps = {
  readonly value: string
  readonly options: readonly ProjectTaskAssigneeOption[]
  readonly onValueChange: (
    value: string,
    option: ProjectTaskAssigneeOption | null
  ) => void
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

function optionMatches(
  option: ProjectTaskAssigneeOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true

  return normalizeChoice(
    [
      option.name,
      option.label,
      option.companyName,
      option.email,
      option.contactType,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
}

function AssigneeOption({
  option,
  selected,
  onSelect,
}: {
  readonly option: ProjectTaskAssigneeOption
  readonly selected: boolean
  readonly onSelect: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{option.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {option.source === "directory"
            ? `${option.companyName ?? option.contactType} · Directory`
            : option.companyName ?? option.contactType}
        </span>
      </span>
      {selected && <IconCheck className="mt-0.5 size-4 shrink-0" />}
    </button>
  )
}

export function ProjectAssigneePicker({
  value,
  options,
  onValueChange,
  placeholder = "Choose contact or type a name...",
  className,
  disabled = false,
  clearLabel = "Clear",
}: ProjectAssigneePickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalizeChoice(query)
  const normalizedValue = normalizeChoice(value)
  const selectedOption =
    options.find(
      (option) =>
        normalizeChoice(option.name) === normalizedValue ||
        normalizeChoice(option.label) === normalizedValue
    ) ?? null
  const projectOptions = options.filter(
    (option) =>
      option.source === "project" && optionMatches(option, normalizedQuery)
  )
  const directoryOptions = options.filter(
    (option) =>
      option.source === "directory" && optionMatches(option, normalizedQuery)
  )

  function selectOption(option: ProjectTaskAssigneeOption): void {
    onValueChange(option.name, option)
    setQuery("")
    setOpen(false)
  }

  function useTypedName(): void {
    const typedName = query.trim()
    if (!typedName) return

    onValueChange(typedName, null)
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
            placeholder="Search contacts or type a name..."
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {projectOptions.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Project &amp; team contacts
              </p>
              {projectOptions.map((option) => (
                <AssigneeOption
                  key={option.id}
                  option={option}
                  selected={selectedOption?.id === option.id}
                  onSelect={() => selectOption(option)}
                />
              ))}
            </div>
          )}

          {directoryOptions.length > 0 && (
            <div className="mt-2 space-y-1 border-t pt-2">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Directory contacts
              </p>
              {directoryOptions.map((option) => (
                <AssigneeOption
                  key={option.id}
                  option={option}
                  selected={selectedOption?.id === option.id}
                  onSelect={() => selectOption(option)}
                />
              ))}
            </div>
          )}

          {projectOptions.length === 0 && directoryOptions.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No matching contacts.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onValueChange("", null)
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
