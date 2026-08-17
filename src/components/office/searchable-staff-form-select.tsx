"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"

import type { StaffMessageAssigneeDto } from "@/app/actions/staff-message-desk"
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

function assigneeLabel(assignee: StaffMessageAssigneeDto): string {
  return assignee.isCurrentUser ? `${assignee.name} (You)` : assignee.name
}

function assigneeSearchValue(assignee: StaffMessageAssigneeDto): string {
  return [assignee.name, assignee.email, assignee.isCurrentUser ? "you me" : ""]
    .filter(Boolean)
    .join(" ")
}

export function SearchableStaffFormSelect({
  assignees,
  name = "assigneeUserId",
  placeholder = "Select a staff member…",
}: {
  readonly assignees: readonly StaffMessageAssigneeDto[]
  readonly name?: string
  readonly placeholder?: string
}): React.ReactElement {
  const { pending } = useFormStatus()
  const [open, setOpen] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")
  const selectedAssignee =
    assignees.find((assignee) => assignee.id === selectedId) ?? null

  return (
    <>
      <input type="hidden" name={name} value={selectedId} readOnly />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required="true"
            disabled={pending || assignees.length === 0}
            className="h-10 w-full justify-between bg-background px-3 font-normal"
          >
            <span
              className={cn(
                "min-w-0 truncate text-left",
                !selectedAssignee && "text-muted-foreground"
              )}
            >
              {selectedAssignee ? assigneeLabel(selectedAssignee) : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder="Search staff by name or email…" />
            <CommandList className="compass-content-scroll max-h-72">
              <CommandEmpty>No matching staff members.</CommandEmpty>
              <CommandGroup>
                {assignees.map((assignee) => (
                  <CommandItem
                    key={assignee.id}
                    value={assigneeSearchValue(assignee)}
                    onSelect={() => {
                      setSelectedId(assignee.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selectedId === assignee.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {assigneeLabel(assignee)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {assignee.email}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  )
}
