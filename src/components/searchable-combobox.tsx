"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

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
import { reconcileSearchableComboboxValue } from "@/lib/searchable-combobox"
import { cn } from "@/lib/utils"

export type SearchableComboboxOption = {
  readonly value: string
  readonly label: string
  readonly selectedLabel?: string
  readonly description?: string
  readonly keywords?: string
}

export type SearchableComboboxProps = {
  readonly options: readonly SearchableComboboxOption[]
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly id?: string
  readonly ariaLabel: string
  readonly placeholder: string
  readonly searchPlaceholder?: string
  readonly emptyMessage?: string
  readonly groupHeading?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly className?: string
  readonly popoverClassName?: string
}
export function SearchableCombobox({
  options,
  value,
  onValueChange,
  id,
  ariaLabel,
  placeholder,
  searchPlaceholder = "Search...",
  emptyMessage = "No matching options.",
  groupHeading,
  disabled = false,
  required = false,
  className,
  popoverClassName,
}: SearchableComboboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const selectedOption =
    options.find((option) => option.value === value) ?? null

  React.useEffect(() => {
    const nextValue = reconcileSearchableComboboxValue(options, value)
    if (nextValue !== value) onValueChange(nextValue)
  }, [onValueChange, options, value])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-required={required}
          disabled={disabled || options.length === 0}
          className={cn(
            "h-10 w-full min-w-0 justify-between px-3 text-left font-normal",
            className
          )}
        >
          <span
            className={cn(
              "truncate",
              selectedOption === null && "text-muted-foreground"
            )}
          >
            {selectedOption?.selectedLabel ??
              selectedOption?.label ??
              placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[18rem] max-w-[calc(100vw-2rem)] p-0",
          popoverClassName
        )}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="compass-content-scroll max-h-72">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup heading={groupHeading}>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description ?? ""} ${option.keywords ?? ""} ${option.value}`}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {option.label}
                    </span>
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
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function SearchableComboboxField({
  name,
  defaultValue = "",
  required = false,
  ...props
}: Omit<SearchableComboboxProps, "value" | "onValueChange"> & {
  readonly name: string
  readonly defaultValue?: string
}): React.ReactElement {
  const [value, setValue] = React.useState(defaultValue)

  React.useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <SearchableCombobox
        {...props}
        value={value}
        onValueChange={setValue}
        required={required}
      />
    </>
  )
}
