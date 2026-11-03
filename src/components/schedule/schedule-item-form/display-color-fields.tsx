"use client"

import type { UseFormReturn } from "react-hook-form"
import { Input } from "@/components/ui/input"
import {
  DISPLAY_COLOR_OPTIONS,
  getScheduleItemDisplayColor,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"
import { cn } from "@/lib/utils"
import type { ScheduleItemFormValues } from "./form-model"

/** Palette swatches, a custom color input and recently used colors. */
export function DisplayColorFields({
  form,
  displayColorPalette,
  recentColors,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly displayColorPalette: DisplayColorPalette
  readonly recentColors: readonly string[]
}) {
  const watchedDisplayColor = form.watch("displayColor")
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">Display color</span>
        <div className="flex items-center gap-1.5" aria-label="Display color">
          {DISPLAY_COLOR_OPTIONS.map((color) => {
            const selected = watchedDisplayColor === color.value
            return (
              <button
                key={color.value}
                type="button"
                title={color.label}
                aria-label={color.label}
                aria-pressed={selected}
                className={cn(
                  "size-5 rounded-full border-2 transition-transform",
                  selected
                    ? "border-foreground scale-110"
                    : "border-transparent hover:scale-110"
                )}
                style={{ backgroundColor: displayColorPalette[color.value] }}
                onClick={() => form.setValue("displayColor", color.value)}
              />
            )
          })}
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="color"
            aria-label="Custom schedule item color"
            className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            value={getScheduleItemDisplayColor(
              { displayColor: watchedDisplayColor },
              displayColorPalette
            )}
            onChange={(event) =>
              form.setValue("displayColor", event.currentTarget.value, {
                shouldDirty: true
              })
            }
          />
          Custom
        </label>
      </div>
      {recentColors.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Recent</span>
          <div className="flex items-center gap-1.5" aria-label="Recently used colors">
            {recentColors.map((color) => {
              const selected = watchedDisplayColor.toLowerCase() === color
              return (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-label={`Recent color ${color}`}
                  aria-pressed={selected}
                  className={cn(
                    "size-5 rounded-full border-2 transition-transform",
                    selected
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-110"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() =>
                    form.setValue("displayColor", color, { shouldDirty: true })
                  }
                />
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
