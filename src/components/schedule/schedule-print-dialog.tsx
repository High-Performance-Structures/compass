"use client"

import * as React from "react"
import {
  IconCalendar,
  IconList,
  IconPrinter,
  IconTimeline,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  filterScheduleItemsForPrint,
  normalizeSchedulePrintRange,
  schedulePrintPresetRange,
  type SchedulePrintDateRange,
  type SchedulePrintLayout,
  type SchedulePrintPreset,
  type SchedulePrintRangeItem,
} from "@/lib/schedule/print-range"

export interface SchedulePrintSelection {
  readonly layout: SchedulePrintLayout
  readonly range: SchedulePrintDateRange
}

function todayDateKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isPrintPreset(value: string): value is SchedulePrintPreset {
  return (
    value === "next_7" ||
    value === "next_14" ||
    value === "next_30" ||
    value === "entire_schedule" ||
    value === "custom"
  )
}

const LAYOUT_OPTIONS = [
  { value: "list" as const, label: "List", icon: IconList },
  { value: "gantt" as const, label: "Gantt", icon: IconTimeline },
  { value: "calendar" as const, label: "Calendar", icon: IconCalendar },
]

export function SchedulePrintDialog({
  defaultLayout,
  items,
  onOpenChange,
  onPrint,
  open,
}: {
  readonly defaultLayout: SchedulePrintLayout
  readonly items: readonly SchedulePrintRangeItem[]
  readonly onOpenChange: (open: boolean) => void
  readonly onPrint: (selection: SchedulePrintSelection) => void
  readonly open: boolean
}): React.ReactElement {
  const today = React.useMemo(todayDateKey, [])
  const initialRange = React.useMemo(
    () => schedulePrintPresetRange("next_7", today, items),
    [items, today]
  )
  const [layout, setLayout] =
    React.useState<SchedulePrintLayout>(defaultLayout)
  const [preset, setPreset] =
    React.useState<SchedulePrintPreset>("next_7")
  const [start, setStart] = React.useState(initialRange.start)
  const [end, setEnd] = React.useState(initialRange.end)

  React.useEffect(() => {
    if (!open) return
    setLayout(defaultLayout)
  }, [defaultLayout, open])

  const range = normalizeSchedulePrintRange(start, end)
  const itemCount = range
    ? filterScheduleItemsForPrint(items, range).length
    : 0

  function selectPreset(value: string): void {
    if (!isPrintPreset(value)) return
    setPreset(value)
    if (value === "custom") return
    const nextRange = schedulePrintPresetRange(value, today, items)
    setStart(nextRange.start)
    setEnd(nextRange.end)
  }

  function submit(): void {
    if (!range) return
    onPrint({ layout, range })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print schedule</DialogTitle>
          <DialogDescription>
            Choose a layout and timeframe. Items that cross either date remain
            visible in the report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Layout</Label>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={layout === option.value ? "default" : "outline"}
                  onClick={() => setLayout(option.value)}
                >
                  <option.icon className="size-4" />
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-print-range">Timeframe</Label>
            <Select value={preset} onValueChange={selectPreset}>
              <SelectTrigger id="schedule-print-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_7">Next 7 days</SelectItem>
                <SelectItem value="next_14">Next 14 days</SelectItem>
                <SelectItem value="next_30">Next 30 days</SelectItem>
                <SelectItem value="entire_schedule">
                  Entire schedule
                </SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-print-start">From</Label>
              <Input
                id="schedule-print-start"
                type="date"
                value={start}
                onChange={(event) => {
                  setStart(event.currentTarget.value)
                  setPreset("custom")
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-print-end">Through</Label>
              <Input
                id="schedule-print-end"
                type="date"
                value={end}
                onChange={(event) => {
                  setEnd(event.currentTarget.value)
                  setPreset("custom")
                }}
              />
            </div>
          </div>

          <p className="border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {range
              ? `${itemCount} schedule item${itemCount === 1 ? "" : "s"} will be included.`
              : "The ending date must be on or after the starting date."}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!range}>
            <IconPrinter className="size-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
