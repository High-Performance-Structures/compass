"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  isValidRecipientEmail,
  normalizeRecipientEmail,
  type EmailRecipientCategory,
  type EmailRecipientOption,
} from "@/lib/email/recipient-options"
import { cn } from "@/lib/utils"

const RECIPIENT_GROUPS: readonly {
  readonly category: EmailRecipientCategory
  readonly label: string
}[] = [
  { category: "vendor", label: "Vendor contacts" },
  { category: "client", label: "Client contacts" },
  { category: "internal", label: "Internal team" },
]

function uniqueNormalizedEmails(values: readonly string[]): readonly string[] {
  return Array.from(
    new Set(
      values
        .map(normalizeRecipientEmail)
        .filter((value) => isValidRecipientEmail(value))
    )
  )
}

function optionSearchValue(option: EmailRecipientOption): string {
  return [
    option.displayName,
    option.companyName,
    option.email,
    option.category,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
}

function optionDetail(option: EmailRecipientOption): string {
  return [option.companyName, option.email].filter(Boolean).join(" · ")
}

export function EmailRecipientPicker({
  id,
  label,
  options,
  value,
  onChange,
  excludedEmails = [],
  placeholder = "Choose a contact or enter an email...",
  required = false,
}: {
  readonly id: string
  readonly label: string
  readonly options: readonly EmailRecipientOption[]
  readonly value: readonly string[]
  readonly onChange: (emails: readonly string[]) => void
  readonly excludedEmails?: readonly string[]
  readonly placeholder?: string
  readonly required?: boolean
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const emails = uniqueNormalizedEmails(value)
  const selected = new Set(emails)
  const excluded = new Set(uniqueNormalizedEmails(excludedEmails))
  const optionByEmail = new Map(
    options.map((option) => [normalizeRecipientEmail(option.email), option])
  )
  const visibleOptions = options.filter(
    (option) => !excluded.has(normalizeRecipientEmail(option.email))
  )
  const recommendedOptions = visibleOptions.filter(
    (option) => option.recommended
  )
  const manualEmail = normalizeRecipientEmail(query)
  const canAddManual =
    isValidRecipientEmail(manualEmail) &&
    !selected.has(manualEmail) &&
    !excluded.has(manualEmail)

  function toggleEmail(email: string): void {
    const normalized = normalizeRecipientEmail(email)
    if (selected.has(normalized)) {
      onChange(emails.filter((candidate) => candidate !== normalized))
      return
    }
    if (!excluded.has(normalized) && isValidRecipientEmail(normalized)) {
      onChange([...emails, normalized])
    }
  }

  function addManualEmail(): void {
    if (!canAddManual) return
    onChange([...emails, manualEmail])
    setQuery("")
  }

  function renderOption(option: EmailRecipientOption): React.ReactElement {
    const email = normalizeRecipientEmail(option.email)
    const checked = selected.has(email)

    return (
      <CommandItem
        key={`${option.id}:${email}`}
        value={optionSearchValue(option)}
        onSelect={() => toggleEmail(email)}
      >
        <IconCheck
          className={cn("size-4", checked ? "opacity-100" : "opacity-0")}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{option.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {optionDetail(option)}
          </p>
        </div>
      </CommandItem>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <div className="rounded-md border bg-background p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {emails.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {emails.map((email) => {
              const option = optionByEmail.get(email)
              return (
                <span
                  key={email}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
                  title={email}
                >
                  <span className="max-w-48 truncate font-medium">
                    {option?.displayName ?? email}
                  </span>
                  {option ? (
                    <span className="hidden max-w-56 truncate text-muted-foreground sm:inline">
                      {email}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${option?.displayName ?? email}`}
                    onClick={() => toggleEmail(email)}
                  >
                    <IconX className="size-3.5" />
                  </button>
                </span>
              )
            })}
          </div>
        ) : null}

        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) setQuery("")
          }}
        >
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="ghost"
              role="combobox"
              aria-expanded={open}
              aria-required={required}
              className={cn(
                "h-8 w-full justify-between px-2 font-normal",
                emails.length === 0 && "text-muted-foreground"
              )}
            >
              <span className="truncate">
                {emails.length > 0 ? "Add another recipient" : placeholder}
              </span>
              <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:min-w-80"
          >
            <Command>
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search contacts or type an email..."
              />
              <CommandList>
                <CommandEmpty>
                  {query.trim()
                    ? "Enter a complete email address to add it."
                    : "No email contacts found."}
                </CommandEmpty>
                {canAddManual ? (
                  <CommandGroup heading="New email">
                    <CommandItem
                      value={`Add ${manualEmail}`}
                      onSelect={addManualEmail}
                    >
                      Add {manualEmail}
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {recommendedOptions.length > 0 ? (
                  <CommandGroup heading="Recommended">
                    {recommendedOptions.map(renderOption)}
                  </CommandGroup>
                ) : null}
                {RECIPIENT_GROUPS.map((group) => {
                  const groupOptions = visibleOptions.filter(
                    (option) =>
                      option.category === group.category && !option.recommended
                  )
                  return groupOptions.length > 0 ? (
                    <CommandGroup key={group.category} heading={group.label}>
                      {groupOptions.map(renderOption)}
                    </CommandGroup>
                  ) : null
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-muted-foreground">
        Select existing contacts or type a new email address.
      </p>
    </div>
  )
}
