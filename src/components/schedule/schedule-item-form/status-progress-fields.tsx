"use client"

import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel
} from "@/components/ui/form"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { STATUS_OPTIONS } from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import {
  percentForStatusChange,
  statusForPercentChange,
  type ScheduleItemFormValues,
} from "./form-model"

/** Status, responsible contact, milestone and progress. */
export function StatusProgressFields({
  form,
  assigneeOptions,
  setAssignedOptionId,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly setAssignedOptionId: (id: string | null) => void
}) {
  const watchedStatus = form.watch("status")
  const watchedPercent = form.watch("percentComplete")
  return (
    <>
    {/* Status + Assignee + Milestone row */}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs text-muted-foreground font-medium">
              Status
            </FormLabel>
            <Select
              onValueChange={(status) => {
                field.onChange(status)
                const percent = percentForStatusChange(status, watchedPercent)
                if (percent !== null) {
                  form.setValue("percentComplete", percent, { shouldDirty: true })
                }
              }}
              value={field.value}
            >
              <FormControl>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="assignedTo"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs text-muted-foreground font-medium">
              Responsible contact
            </FormLabel>
            <ProjectAssigneePicker
              value={field.value}
              options={assigneeOptions}
              onValueChange={(value, option) => {
                field.onChange(value)
                setAssignedOptionId(option?.id ?? null)
                if (option?.contactType === "owner" || option?.contactType === "subcontractor" || option?.contactType === "supplier") {
                  form.setValue("confirmationRequired", true, { shouldDirty: true })
                }
                if (option?.contactType === "owner") {
                  form.setValue("ownerVisible", true, {
                    shouldDirty: true
                  })
                }
                if (
                  option?.contactType === "subcontractor" ||
                  option?.contactType === "supplier"
                ) {
                  form.setValue("subVendorVisible", true, {
                    shouldDirty: true
                  })
                }
              }}
              placeholder="Choose contact or type a name..."
            />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="isMilestone"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2 pb-0.5">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="!mt-0 text-xs text-muted-foreground font-medium">
              Milestone
            </FormLabel>
          </FormItem>
        )}
      />
    </div>

    {/* Progress */}
    <FormField
      control={form.control}
      name="percentComplete"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground font-medium">
            Progress
          </FormLabel>
          <div className="flex items-center gap-3">
            <FormControl>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[field.value]}
                onValueChange={([value]) => {
                  field.onChange(value)
                  const status = statusForPercentChange(value, watchedStatus)
                  if (status !== null) {
                    form.setValue("status", status, { shouldDirty: true })
                  }
                }}
                className="flex-1"
              />
            </FormControl>
            <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
              {watchedPercent}%
            </span>
          </div>
        </FormItem>
      )}
    />
    </>
  )
}
