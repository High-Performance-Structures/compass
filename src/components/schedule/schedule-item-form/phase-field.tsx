"use client"

import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { IconTrash } from "@tabler/icons-react"
import {
  CUSTOM_PHASE_VALUE,
  schedulePhasePickerOptions,
  type ScheduleItemFormValues,
} from "./form-model"
import type { PhaseOptionsState } from "./use-phase-options"

/** Phase picker with the reusable catalog and a custom-phase entry. */
export function PhaseField({
  form,
  phase,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly phase: PhaseOptionsState
}) {
  const {
    phaseOptions,
    phaseOptionsLoading,
    customPhaseMode,
    customPhaseName,
    saveCustomPhase,
    setCustomPhaseMode,
    setCustomPhaseName,
    setSaveCustomPhase,
    removeSelectedSavedPhase,
  } = phase
  return (
    <FormField
      control={form.control}
      name="phase"
      render={({ field }) => {
        const selectedSavedPhase = phaseOptions.find(
          (option) =>
            option.value === field.value && option.source === "saved"
        )
        return (
          <FormItem>
            <FormLabel className="text-xs font-medium text-muted-foreground">
              Phase
            </FormLabel>
            <div className="flex items-center gap-2">
              <FormControl>
                <SearchableCombobox
                  className="h-9 flex-1"
                  value={customPhaseMode ? CUSTOM_PHASE_VALUE : field.value}
                  onValueChange={(value) => {
                    // An empty value is the picker's own reset; keep the saved phase.
                    if (value === "") return
                    if (value === CUSTOM_PHASE_VALUE) {
                      setCustomPhaseMode(true)
                      setCustomPhaseName("")
                      setSaveCustomPhase(true)
                      field.onChange("")
                      return
                    }
                    setCustomPhaseMode(false)
                    setCustomPhaseName("")
                    field.onChange(value)
                  }}
                  options={schedulePhasePickerOptions(phaseOptions, field.value)}
                  ariaLabel="Phase"
                  placeholder={phaseOptionsLoading ? "Loading phases…" : "Choose phase"}
                  searchPlaceholder="Search phases..."
                  emptyMessage="No matching phases."
                />
              </FormControl>
              {selectedSavedPhase?.id && !customPhaseMode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 text-muted-foreground"
                  title="Remove from reusable phases"
                  aria-label={`Remove ${selectedSavedPhase.label} from reusable phases`}
                  onClick={() => void removeSelectedSavedPhase(field.value)}
                >
                  <IconTrash className="size-4" />
                </Button>
              )}
            </div>
            {customPhaseMode && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <Input
                  value={customPhaseName}
                  maxLength={100}
                  placeholder="Custom phase name"
                  autoFocus
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setCustomPhaseName(value)
                    field.onChange(value)
                  }}
                />
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={saveCustomPhase}
                    onCheckedChange={(checked) =>
                      setSaveCustomPhase(checked === true)
                    }
                  />
                  <span>
                    Save to the reusable phase list for future schedules and templates
                  </span>
                </label>
              </div>
            )}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
