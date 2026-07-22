"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconPlus } from "@tabler/icons-react"

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
import type { SchedulePhaseOption } from "@/lib/schedule/types"
import { cn } from "@/lib/utils"

function phaseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function SchedulePhaseCombobox({
  value,
  options,
  onChange,
}: {
  readonly value: string
  readonly options: readonly SchedulePhaseOption[]
  readonly onChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const typedPhase = query.trim()
  const selectedKey = phaseKey(value)
  const exactTypedMatch = options.some(
    (option) => phaseKey(option.value) === phaseKey(typedPhase)
  )
  const projectOptions = options.filter((option) => option.projectPhase)
  const standardOptions = options.filter((option) => !option.projectPhase)

  function choose(nextValue: string): void {
    onChange(nextValue)
    setQuery("")
    setOpen(false)
  }

  function optionItem(option: SchedulePhaseOption): React.ReactElement {
    return (
      <CommandItem
        key={option.value}
        value={`${option.label} ${option.value}`}
        onSelect={() => choose(option.value)}
      >
        <IconCheck
          className={cn(
            "size-4",
            selectedKey === phaseKey(option.value) ? "opacity-100" : "opacity-0"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.taskCount > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {option.taskCount}
          </span>
        )}
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between rounded-none border-x-0 border-t-0 px-0 font-normal shadow-none"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || "Choose a phase or category"}
          </span>
          <IconChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(32rem,calc(100vw-3rem))] p-0"
      >
        <Command shouldFilter>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search phases or type a new one..."
          />
          <CommandList className="compass-content-scroll max-h-72 overflow-y-auto overscroll-contain">
            <CommandEmpty>No matching phase or category.</CommandEmpty>
            {projectOptions.length > 0 && (
              <CommandGroup heading="In this schedule">
                {projectOptions.map(optionItem)}
              </CommandGroup>
            )}
            {standardOptions.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Standard phases">
                  {standardOptions.map(optionItem)}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={!typedPhase || exactTypedMatch}
              onClick={() => choose(typedPhase)}
            >
              <IconPlus className="size-4" />
              {typedPhase ? `Add phase: ${typedPhase}` : "Type a new phase above"}
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
