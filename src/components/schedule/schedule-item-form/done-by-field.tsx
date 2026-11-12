"use client"

import type { UseFormReturn } from "react-hook-form"

import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { Button } from "@/components/ui/button"
import { FormField, FormItem, FormLabel } from "@/components/ui/form"
import { SCHEDULE_DONE_BY, type ScheduleDoneBy } from "@/lib/domain/schedule/statuses"

import type { ScheduleItemFormValues } from "./form-model"

/**
 * Which department does the item's work, or an outside trade. Filled from the
 * first crew or company picked; tapping the chosen one again clears it.
 */
export function ScheduleDoneByField({ form }: { readonly form: UseFormReturn<ScheduleItemFormValues> }) {
  const profiles = useDepartmentProfiles()
  const label = (value: ScheduleDoneBy): string => (value === "outside" ? "Outside trade" : profiles[value].shortName)
  return (
    <FormField
      control={form.control}
      name="doneBy"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground font-medium">Done by</FormLabel>
          <div role="radiogroup" aria-label="Done by" className="flex flex-wrap gap-1.5">
            {SCHEDULE_DONE_BY.map((value) => {
              const selected = field.value === value
              return (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  className="h-8"
                  onClick={() => field.onChange(selected ? null : value)}
                >
                  {label(value)}
                </Button>
              )
            })}
          </div>
        </FormItem>
      )}
    />
  )
}
