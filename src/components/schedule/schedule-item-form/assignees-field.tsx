"use client"

import { IconX } from "@tabler/icons-react"
import type { UseFormReturn } from "react-hook-form"

import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { Button } from "@/components/ui/button"
import { FormField, FormItem, FormLabel } from "@/components/ui/form"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { MAX_SCHEDULE_ASSIGNEES } from "@/lib/schedule/assignees"

import type { ScheduleItemFormValues } from "./form-model"

type Assignee = ScheduleItemFormValues["assignees"][number]

/** The list with `name` added once, or unchanged for a blank or repeated name. */
export function withAssignee(
  current: readonly Assignee[],
  name: string,
  optionId: string | null
): Assignee[] {
  const trimmed = name.trim()
  const repeated = current.some((assignee) => assignee.name.trim().toLowerCase() === trimmed.toLowerCase())
  if (!trimmed || repeated || current.length >= MAX_SCHEDULE_ASSIGNEES) return [...current]
  return [...current, { name: trimmed, optionId }]
}

/**
 * Everyone responsible for the item. All assignees are equal; the picker
 * offers the same project, team and directory contacts as before, and a
 * typed name still works.
 */
export function ScheduleAssigneesField({
  form,
  assigneeOptions,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
}) {
  // Picking an owner or vendor asks them to confirm and shows them the item,
  // as picking one did when an item had a single assignee.
  function applyAudience(option: ProjectTaskAssigneeOption): void {
    const external = option.contactType === "owner" || option.contactType === "subcontractor" || option.contactType === "supplier"
    if (external) form.setValue("confirmationRequired", true, { shouldDirty: true })
    if (option.contactType === "owner") form.setValue("ownerVisible", true, { shouldDirty: true })
    if (option.contactType === "subcontractor" || option.contactType === "supplier") {
      form.setValue("subVendorVisible", true, { shouldDirty: true })
    }
  }

  return (
    <FormField
      control={form.control}
      name="assignees"
      render={({ field }) => {
        const assignees = field.value
        const pickedNames = new Set(assignees.map((assignee) => assignee.name.trim().toLowerCase()))
        return (
          <FormItem>
            <FormLabel className="text-xs text-muted-foreground font-medium">
              Responsible people
            </FormLabel>
            {assignees.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Assigned people">
                {assignees.map((assignee, index) => (
                  <li
                    key={assignee.name}
                    className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
                  >
                    <span className="max-w-[12rem] truncate">{assignee.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      aria-label={`Remove ${assignee.name}`}
                      onClick={() => field.onChange(assignees.filter((_, position) => position !== index))}
                    >
                      <IconX className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <ProjectAssigneePicker
              value=""
              options={assigneeOptions.filter((option) => !pickedNames.has(option.name.trim().toLowerCase()))}
              disabled={assignees.length >= MAX_SCHEDULE_ASSIGNEES}
              clearLabel="Remove everyone"
              placeholder={assignees.length > 0 ? "Add another person..." : "Choose contacts or type a name..."}
              onValueChange={(value, option) => {
                // The picker's clear button sends an empty value.
                if (!value.trim()) {
                  field.onChange([])
                  return
                }
                field.onChange(withAssignee(assignees, value, option?.id ?? null))
                if (option) applyAudience(option)
              }}
            />
          </FormItem>
        )
      }}
    />
  )
}
