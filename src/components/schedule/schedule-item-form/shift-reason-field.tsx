"use client"

import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import type { ScheduleItemFormValues } from "./form-model"

/** Why the dates or predecessors moved; saved in activity history. */
export function ShiftReasonField({
  form,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
}) {
  return (
    <FormField
      control={form.control}
      name="shiftReason"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground font-medium">
            Schedule shift reason
          </FormLabel>
          <FormControl>
            <Textarea
              placeholder="Required when dates or predecessors change"
              className="min-h-[60px] resize-none text-sm"
              maxLength={500}
              {...field}
            />
          </FormControl>
          <p className="text-xs text-muted-foreground">
            Saved in activity history. If the project finish moves later,
            project administrators are warned that a change order may be needed.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
