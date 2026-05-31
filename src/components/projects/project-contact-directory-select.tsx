"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"

import type { IndependentContactItem } from "@/app/actions/project-contacts"
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
import { cn } from "@/lib/utils"

function contactTypeLabel(type: IndependentContactItem["contactType"]): string {
  switch (type) {
    case "owner":
      return "Customer"
    case "supplier":
      return "Vendor - supplier"
    case "subcontractor":
      return "Vendor - subcontractor"
    case "internal":
      return "Internal"
  }
}

function sourceLabel(contact: IndependentContactItem): string {
  if (contact.sourceSystem.includes("sage")) return "Sage"
  if (contact.syncStatus === "needs_sage_review") return "BT only"
  return "Compass"
}

export function ProjectContactDirectorySelect({
  contacts,
}: {
  readonly contacts: readonly IndependentContactItem[]
}): React.ReactElement {
  const { pending } = useFormStatus()
  const [selectedId, setSelectedId] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const selectedContact = contacts.find((contact) => contact.id === selectedId)

  function contactSearchValue(contact: IndependentContactItem): string {
    return [
      contact.name,
      contactTypeLabel(contact.contactType),
      sourceLabel(contact),
      contact.id,
    ].join(" ")
  }

  return (
    <>
      <input
        type="hidden"
        name="independentContactId"
        value={selectedId}
        readOnly
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label="Add from directory"
            aria-expanded={open}
            disabled={pending}
            className="h-9 min-w-0 flex-1 justify-between px-3 font-normal"
          >
            <span
              className={cn(
                "truncate",
                !selectedContact && "text-muted-foreground"
              )}
            >
              {selectedContact
                ? `${selectedContact.name} - ${contactTypeLabel(
                    selectedContact.contactType
                  )} - ${sourceLabel(selectedContact)}`
                : "Add from directory"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder="Search directory..." />
            <CommandList>
              <CommandEmpty>No directory contacts found.</CommandEmpty>
              <CommandGroup>
                {contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={contactSearchValue(contact)}
                    onSelect={() => {
                      setSelectedId(contact.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selectedId === contact.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{contact.name}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {contactTypeLabel(contact.contactType)} -{" "}
                        {sourceLabel(contact)}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={pending || !selectedId}
      >
        {pending ? "Adding..." : "Add to project"}
      </Button>
    </>
  )
}
