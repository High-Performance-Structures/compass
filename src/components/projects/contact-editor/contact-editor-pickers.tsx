"use client"

import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { useState } from "react"

import type {
  ProjectContactCostCodeOption,
  ProjectContactDirectoryOption,
} from "@/lib/domain/contacts/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import { directorySourceLabel, groupedDirectoryOptions } from "./contact-editor-rules"

export function DirectoryPicker({
  options,
  selected,
  onSelect,
  placeholder = "Choose a contact or enter one manually...",
  searchPlaceholder = "Search customers, vendors, or staff...",
}: {
  readonly options: readonly ProjectContactDirectoryOption[]
  readonly selected: ProjectContactDirectoryOption | null
  readonly onSelect: (option: ProjectContactDirectoryOption) => void
  readonly placeholder?: string
  readonly searchPlaceholder?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const groups = groupedDirectoryOptions(options)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.displayName : placeholder}
          </span>
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No matching directory contact.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.sourceType}
                heading={directorySourceLabel(group.sourceType)}
              >
                {group.options.map((option) => (
                  <CommandItem
                    key={`${option.sourceType}:${option.id}`}
                    value={`${option.displayName} ${option.companyName ?? ""} ${option.email ?? ""} ${option.customerContacts.map((person) => `${person.name} ${person.email ?? ""}`).join(" ")}`}
                    disabled={option.alreadyOnProject}
                    onSelect={() => {
                      onSelect(option)
                      setOpen(false)
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 size-4",
                        selected?.id === option.id &&
                          selected.sourceType === option.sourceType
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate">{option.displayName}</p>
                      {(option.companyName || option.email) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {[option.companyName, option.email].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {option.alreadyOnProject && (
                        <p className="text-xs text-muted-foreground">Already on this project</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function CostCodePicker({
  options,
  value,
  onSelect,
}: {
  readonly options: readonly ProjectContactCostCodeOption[]
  readonly value: string
  readonly onSelect: (option: ProjectContactCostCodeOption | null) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const hasBudgetCodes = options.some((option) => option.onBudget)
  const visibleOptions = search.trim() || !hasBudgetCodes ? options : options.filter((option) => option.onBudget)
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); setSearch("") }}>
      <PopoverTrigger asChild>
        <Button
          id="project-contact-cost-code"
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={options.length === 0 && !value}
        >
          <span className="truncate">
            {selected?.label ?? (value || "Choose a cost code...")}
          </span>
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search cost codes..." value={search} onValueChange={setSearch} />
          {hasBudgetCodes ? <p className="border-b px-3 py-2 text-xs text-muted-foreground">Type to search the full company cost-code list.</p> : null}
          <CommandList className="max-h-72">
            <CommandEmpty>No matching cost code.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="Clear cost code"
                  onSelect={() => {
                    onSelect(null)
                    setOpen(false)
                  }}
                >
                  Clear cost code
                </CommandItem>
              )}
              {visibleOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    onSelect(option)
                    setOpen(false)
                  }}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 size-4",
                      selected?.value === option.value
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function VisibilityCheckbox({
  id,
  checked,
  label,
  description,
  onCheckedChange,
}: {
  readonly id: string
  readonly checked: boolean
  readonly label: string
  readonly description: string
  readonly onCheckedChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <div className="grid gap-1 leading-none">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
