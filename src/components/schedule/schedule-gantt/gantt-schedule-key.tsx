"use client"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { IconChevronDown } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import {
  DEFAULT_DISPLAY_COLOR_LABELS,
  DISPLAY_COLOR_OPTIONS,
} from "@/lib/schedule/appearance"
import type { GanttPaletteState } from "./use-gantt-palette"

const COLOR_PICKER_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#6b7280", "#111827",
] as const

/** Floating key of bar colors, editable as personal colors and meanings. */
export function GanttScheduleKey({
  palette,
  showScheduleKey,
  setShowScheduleKey,
  editingScheduleKey,
  setEditingScheduleKey,
}: {
  readonly palette: GanttPaletteState
  readonly showScheduleKey: boolean
  readonly setShowScheduleKey: (update: (open: boolean) => boolean) => void
  readonly editingScheduleKey: boolean
  readonly setEditingScheduleKey: (update: (editing: boolean) => boolean) => void
}) {
  const {
    displayColorPalette,
    displayColorLabels,
    updatePaletteColor,
    updatePaletteLabel,
    resetPalette,
  } = palette
  return (
  <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
    {showScheduleKey && (
      <div className="w-72 rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium">Schedule key</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => setEditingScheduleKey((editing) => !editing)}
          >
            {editingScheduleKey ? "Done" : "Edit"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {DISPLAY_COLOR_OPTIONS.map((color) => (
            <div
              key={color.value}
              className="flex items-center gap-1.5 text-xs text-foreground"
            >
              {editingScheduleKey ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Choose ${color.label} schedule color`}
                      className="size-5 shrink-0 rounded-full"
                      style={{ backgroundColor: displayColorPalette[color.value] }}
                    />
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-44 p-2">
                    <p className="mb-2 text-xs font-medium">Choose {color.label}</p>
                    <div className="grid grid-cols-6 gap-1.5">
                      {COLOR_PICKER_SWATCHES.map((swatch) => (
                        <button
                          key={swatch}
                          type="button"
                          aria-label={`Set ${color.label} to ${swatch}`}
                          className={cn(
                            "size-5 rounded border border-border shadow-sm transition-transform hover:scale-110",
                            displayColorPalette[color.value] === swatch && "ring-2 ring-ring ring-offset-1"
                          )}
                          style={{ backgroundColor: swatch }}
                          onClick={() => updatePaletteColor(color.value, swatch)}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <span
                  aria-hidden="true"
                  className="size-5 rounded-full"
                  style={{ backgroundColor: displayColorPalette[color.value] }}
                />
              )}
              {editingScheduleKey ? (
                <span
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  tabIndex={0}
                  aria-label={`${color.label} schedule meaning`}
                  className="min-w-0 outline-none"
                  onBlur={(event) => {
                    const meaning = event.currentTarget.textContent?.trim()
                    updatePaletteLabel(color.value, meaning || DEFAULT_DISPLAY_COLOR_LABELS[color.value])
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                >
                  {displayColorLabels[color.value]}
                </span>
              ) : (
                <span>{displayColorLabels[color.value]}</span>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-6 px-1.5 text-xs"
          onClick={resetPalette}
        >
          Reset personal colors
        </Button>
        <div className="mt-3 border-t pt-2 text-xs leading-snug text-muted-foreground">
          <p>Schedule item bars use their chosen display color; phase is grouping only.</p>
          <p className="mt-1">Critical Path View: blue is critical work; gray has float.</p>
        </div>
      </div>
    )}
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 bg-background/95 px-2.5 text-xs shadow-sm backdrop-blur"
      aria-expanded={showScheduleKey}
      onClick={() => setShowScheduleKey((open) => !open)}
    >
      Schedule key
      <IconChevronDown
        className={cn("size-3 transition-transform", showScheduleKey && "rotate-180")}
      />
    </Button>
  </div>
  )
}
