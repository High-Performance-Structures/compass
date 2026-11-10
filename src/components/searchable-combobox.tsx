"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus, X } from "lucide-react"

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
import { creatableComboboxText, reconcileSearchableComboboxValue } from "@/lib/searchable-combobox"
import { cn } from "@/lib/utils"

export type SearchableComboboxOption = {
  readonly value: string
  readonly onBudget?: boolean
  readonly browseGroup?: string
  readonly label: string
  readonly selectedLabel?: string
  readonly description?: string
  readonly keywords?: string
}

export type SearchableComboboxProps = {
  readonly options: readonly SearchableComboboxOption[]
  /** Limits browsing only; typing searches all options and preserves the selected value. */
  readonly browseValues?: readonly string[]
  readonly browseHeading?: string
  readonly searchHint?: string
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly id?: string
  readonly ariaLabel: string
  /** Id of help text read with the control, like aria-describedby on a native select. */
  readonly ariaDescribedBy?: string
  readonly placeholder: string
  readonly searchPlaceholder?: string
  readonly emptyMessage?: string
  readonly groupHeading?: string
  readonly placeholderClassName?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly className?: string
  readonly popoverClassName?: string
  /**
   * Accept values that are not in the list: typing text that matches no
   * option shows "Add “text”", which uses the text as typed. The value is
   * kept and shown even when it is not an option.
   */
  readonly creatable?: boolean
  /** With a value chosen, an item with this label clears it (for optional fields). */
  readonly clearLabel?: string
}
export function SearchableCombobox({
  options,
  browseValues,
  browseHeading,
  searchHint,
  value,
  onValueChange,
  id,
  ariaLabel,
  ariaDescribedBy,
  placeholder,
  searchPlaceholder = "Search...",
  emptyMessage = "No matching options.",
  groupHeading,
  placeholderClassName,
  disabled = false,
  required = false,
  className,
  popoverClassName,
  creatable = false,
  clearLabel,
}: SearchableComboboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const budgetValues = React.useMemo(() => options.filter((option) => option.onBudget).map((option) => option.value), [options])
  const budgetBrowsing = browseValues === undefined && budgetValues.length > 0
  const browsing = search.trim().length === 0 && (browseValues !== undefined || budgetBrowsing)
  const browseSet = React.useMemo(() => new Set(browseValues ?? budgetValues), [browseValues, budgetValues])
  const effectiveHint = searchHint ?? (budgetBrowsing ? "Type to search the full company cost-code list." : undefined)
  const visibleOptions = browsing ? options.filter((option) => browseSet.has(option.value)) : options
  const selectedOption =
    options.find((option) => option.value === value) ?? null
  // A creatable field may hold a typed value that is not an option; show it as is.
  const customValue = creatable && selectedOption === null && value !== "" ? value : null
  const createText = creatable ? creatableComboboxText(options, search) : null
  const itemClassName = creatable ? "min-h-11" : undefined

  React.useEffect(() => {
    if (creatable) return
    const nextValue = reconcileSearchableComboboxValue(options, value)
    if (nextValue !== value) onValueChange(nextValue)
  }, [creatable, onValueChange, options, value])
  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      setSearch("")
    }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-required={required}
          disabled={disabled || (options.length === 0 && !creatable)}
          className={cn(
            "h-10 w-full min-w-0 justify-between px-3 text-left font-normal",
            className
          )}
        >
          <span
            className={cn(
              "truncate",
              selectedOption === null &&
                customValue === null &&
                (placeholderClassName ?? "text-muted-foreground")
            )}
          >
            {selectedOption?.selectedLabel ??
              selectedOption?.label ??
              customValue ??
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
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          {effectiveHint ? <p className="border-b px-3 py-2 text-xs text-muted-foreground">{effectiveHint}</p> : null}
          <CommandList className="compass-content-scroll max-h-72">
            {createText === null && <CommandEmpty>{emptyMessage}</CommandEmpty>}
            {clearLabel && value !== "" && search.trim() === "" && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  className={itemClassName}
                  onSelect={() => {
                    onValueChange("")
                    setOpen(false)
                  }}
                >
                  <X className="size-4" />
                  <span className="text-muted-foreground">{clearLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={browsing ? browseHeading ?? (budgetBrowsing ? options.find((option) => option.onBudget)?.browseGroup ?? "On this job’s budget" : groupHeading) : groupHeading}>
              {visibleOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  className={itemClassName}
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
            {createText !== null && (
              <CommandGroup>
                {/* forceMount: always listed, whatever the filter scores the text. */}
                <CommandItem
                  forceMount
                  value={`__create__ ${createText}`}
                  className={itemClassName}
                  onSelect={() => {
                    onValueChange(createText)
                    setOpen(false)
                  }}
                >
                  <Plus className="size-4" />
                  <span className="min-w-0 flex-1 truncate">
                    Add “{createText}”
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
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
  onValueChange,
  ...props
}: Omit<SearchableComboboxProps, "value" | "onValueChange"> & {
  readonly name: string
  readonly defaultValue?: string
  /** Optional notice of each change, for forms that show fields conditionally. */
  readonly onValueChange?: (value: string) => void
}): React.ReactElement {
  const [value, setValue] = React.useState(defaultValue)
  const handleValueChange = React.useCallback(
    (next: string): void => {
      setValue(next)
      onValueChange?.(next)
    },
    [onValueChange]
  )

  React.useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  return (
    <>
      {/* The button comes first so a wrapping <label> opens the list. */}
      <SearchableCombobox
        {...props}
        value={value}
        onValueChange={handleValueChange}
        required={required}
      />
      {required ? (
        // A hidden input skips constraint validation, so a required field
        // posts through a visually hidden text input instead. The browser
        // then blocks submission and prompts, as a native select would.
        <input
          name={name}
          value={value}
          onChange={() => undefined}
          required
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
      ) : (
        <input type="hidden" name={name} value={value} />
      )}
    </>
  )
}
