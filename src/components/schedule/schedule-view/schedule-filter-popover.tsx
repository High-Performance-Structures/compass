"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { IconFilter, IconX } from "@tabler/icons-react"
import type { TaskFilters, TaskStatus } from "@/lib/schedule/types"
import { EMPTY_FILTERS, STATUS_OPTIONS } from "@/lib/schedule/types"
import { toggleListValue } from "./schedule-view-rules"

/** Status, phase and responsible-contact filters. */
export function ScheduleFilterPopover({
  filters,
  setFilters,
  phaseOptions,
  activeFilterCount,
}: {
  readonly filters: TaskFilters
  readonly setFilters: (filters: TaskFilters) => void
  readonly phaseOptions: readonly { value: string; label: string }[]
  readonly activeFilterCount: number
}) {
  const toggleStatus = (status: TaskStatus) => {
    setFilters({ ...filters, status: toggleListValue(filters.status, status) })
  }

  const togglePhase = (phase: string) => {
    setFilters({ ...filters, phase: toggleListValue(filters.phase, phase) })
  }

  const clearFilters = () => setFilters(EMPTY_FILTERS)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 shrink-0">
          <IconFilter className="size-3.5" />
          <span className="hidden sm:inline ml-1.5">Filters</span>
          {activeFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1.5 h-4 min-w-4 rounded-sm px-1 text-xs"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Status
            </Label>
            <div className="mt-1.5 space-y-1">
              {STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 py-0.5 cursor-pointer"
                >
                  <Checkbox
                    checked={filters.status.includes(opt.value)}
                    onCheckedChange={() => toggleStatus(opt.value)}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Phase
            </Label>
            <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
              {phaseOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 py-0.5 cursor-pointer"
                >
                  <Checkbox
                    checked={filters.phase.includes(opt.value)}
                    onCheckedChange={() => togglePhase(opt.value)}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Responsible Contact
            </Label>
            <Input
              placeholder="Filter by name..."
              value={filters.assignedTo}
              onChange={(e) =>
                setFilters({ ...filters, assignedTo: e.target.value })
              }
              className="mt-1.5 h-8 text-sm"
            />
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={clearFilters}
            >
              <IconX className="size-3 mr-1" />
              Clear all filters
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
