"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconUserPlus } from "@tabler/icons-react"

import type { ScheduleAssigneeOption } from "@/app/actions/schedule-assignees"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ScheduleAssigneeComboboxProps = {
  readonly value: string
  readonly selectedOptionId: string | null
  readonly options: readonly ScheduleAssigneeOption[]
  readonly onChange: (name: string, optionId: string | null) => void
}

export function ScheduleAssigneeCombobox({
  value,
  selectedOptionId,
  options,
  onChange,
}: ScheduleAssigneeComboboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const projectOptions = options.filter((option) => option.projectAccess)
  const directoryOptions = options.filter((option) => !option.projectAccess)
  const typedName = query.trim()

  function choose(option: ScheduleAssigneeOption): void {
    onChange(option.name, option.id)
    setQuery("")
    setOpen(false)
  }

  function useTypedName(): void {
    if (!typedName) return
    onChange(typedName, null)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 w-full justify-between px-3 font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{value || "Choose contact or type a name"}</span>
          <IconChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-3rem))] p-0"
      >
        <Command shouldFilter>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search contacts or type a name..."
          />
          <CommandList className="max-h-72 overflow-y-auto overscroll-contain">
            <CommandEmpty>No matching Compass contacts.</CommandEmpty>
            {projectOptions.length > 0 && (
              <CommandGroup heading="Project contacts">
                {projectOptions.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={`${option.name} ${option.label} ${option.companyName ?? ""} ${option.email ?? ""}`}
                    onSelect={() => choose(option)}
                  >
                    <IconCheck
                      className={cn(
                        "size-4",
                        selectedOptionId === option.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{option.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.companyName ?? option.contactType}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {directoryOptions.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Company directory">
                  {directoryOptions.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.name} ${option.label} ${option.companyName ?? ""} ${option.email ?? ""}`}
                      onSelect={() => choose(option)}
                    >
                      <IconUserPlus className="size-4 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate">{option.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          Adds project access when a Compass account exists
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("", null)
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
              disabled={!typedName}
              onClick={useTypedName}
            >
              Use typed name
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
