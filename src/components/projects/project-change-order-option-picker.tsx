"use client"

import * as React from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type CodingOption = {
  readonly value: string
  readonly label: string
  readonly description?: string
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function ProjectChangeOrderOptionPicker({
  value,
  options,
  placeholder,
  ariaLabel,
  disabled,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly CodingOption[]
  readonly placeholder: string
  readonly ariaLabel: string
  readonly disabled: boolean
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalize(query)
  const selected = options.find((option) => option.value === value) ?? null
  const filteredOptions = options.filter((option) =>
    normalizedQuery.length === 0
      ? true
      : normalize(
          `${option.value} ${option.label} ${option.description ?? ""}`
        ).includes(normalizedQuery)
  )
  const typedValue = query.trim()
  const canUseTypedValue =
    typedValue.length > 0 && normalize(typedValue) !== normalize(value)

  function chooseValue(nextValue: string): void {
    onValueChange(nextValue)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={ariaLabel}
          className="h-8 w-full min-w-0 justify-between rounded-none bg-transparent px-1 text-left text-xs font-normal hover:bg-background"
        >
          <span className="truncate">
            {selected?.label ?? (value || placeholder)}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-3rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${placeholder.toLowerCase()}...`}
          />
          <CommandList className="compass-content-scroll max-h-72">
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.value} ${option.label}`}
                  onSelect={() => chooseValue(option.value)}
                >
                  <IconCheck
                    className={
                      option.value === value
                        ? "size-4 opacity-100"
                        : "size-4 opacity-0"
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chooseValue("")}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseTypedValue}
              onClick={() => chooseValue(typedValue)}
            >
              Use typed value
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function changeOrderMoney(cents: number | null): string {
  if (cents === null) return "Not yet priced"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}
