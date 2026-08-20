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
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useDeveloperMode } from "@/components/developer-mode-provider"

export type SelectionComboboxOption = {
  readonly value: string
  readonly label: string
  readonly description?: string
  readonly needsSageReview?: boolean
}

export function ProjectSelectionComboboxInput({
  id,
  name,
  options,
  placeholder,
  defaultValue = "",
  emptyMessage = "No matching options.",
  manualInputLabel = "Use typed value",
  allowManualInput = true,
}: {
  readonly id: string
  readonly name: string
  readonly options: readonly SelectionComboboxOption[]
  readonly placeholder: string
  readonly defaultValue?: string
  readonly emptyMessage?: string
  readonly manualInputLabel?: string
  readonly allowManualInput?: boolean
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(defaultValue)
  const [searchValue, setSearchValue] = React.useState("")
  const [selectedValue, setSelectedValue] = React.useState<string | null>(null)
  const selectedOption =
    selectedValue === null
      ? null
      : options.find((option) => option.value === selectedValue) ?? null
  const formValue = selectedOption?.value ?? inputValue
  const manualSearchValue = searchValue.trim()
  const manualInputValue = inputValue.trim()
  const canUseSearchValue =
    allowManualInput &&
    manualSearchValue.length > 0 &&
    manualSearchValue !== manualInputValue

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => {
            setInputValue(event.target.value)
            setSelectedValue(null)
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Open options"
              disabled={options.length === 0 && !allowManualInput}
            >
              <ChevronsUpDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(92vw,360px)] p-0">
            <Command>
              <CommandInput
                value={searchValue}
                onValueChange={setSearchValue}
                placeholder="Search..."
              />
              <CommandList className="compass-content-scroll max-h-72">
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value} ${option.description ?? ""}`}
                      onSelect={() => {
                        setSelectedValue(option.value)
                        setInputValue(option.label)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          selectedValue === option.value
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                        {developerModeEnabled && option.needsSageReview && (
                          <span className="mt-1 block text-xs font-medium text-amber-700">
                            Needs Sage review
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
              {allowManualInput && (
                <div className="border-t p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={!canUseSearchValue}
                    onClick={() => {
                      if (!canUseSearchValue) return
                      setInputValue(manualSearchValue)
                      setSelectedValue(null)
                      setOpen(false)
                    }}
                  >
                    {manualInputLabel}
                    {manualSearchValue ? `: ${manualSearchValue}` : ""}
                  </Button>
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    You can also type a custom value directly in the field.
                  </p>
                </div>
              )}
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <input type="hidden" name={name} value={formValue} />
    </div>
  )
}
