"use client"

import type { ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { IconSearch, IconX } from "@tabler/icons-react"
import { STATUS_OPTIONS, type TaskStatus } from "@/lib/schedule/types"
import {
  SCHEDULE_GROUP_MODES,
  SCHEDULE_LIST_COLUMNS,
  SCHEDULE_VIEW_PRESETS,
} from "@/lib/schedule/saved-views"
import { scheduleColumnLabel, toggleListValue } from "./schedule-view-rules"
import type { ScheduleViewState } from "./use-schedule-view-state"
import type { SavedScheduleViewsState } from "./use-saved-schedule-views"
import { ScheduleFilterPopover } from "./schedule-filter-popover"
import { ScheduleSavedViewsPopover } from "./schedule-saved-views-popover"
import { ScheduleOverflowMenu } from "./schedule-overflow-menu"

/** Search, filters, ordering, date range, grouping, columns, views and more. */
export function ScheduleActionBar({
  viewState,
  savedViewsState,
  phaseOptions,
  visibleCount,
  overflowMenu,
}: {
  readonly viewState: ScheduleViewState
  readonly savedViewsState: SavedScheduleViewsState
  readonly phaseOptions: readonly { value: string; label: string }[]
  readonly visibleCount: number
  readonly overflowMenu: ComponentProps<typeof ScheduleOverflowMenu>
}) {
  const {
    view,
    orderMode,
    handleOrderModeChange,
    filters,
    setFilters,
    preset,
    setPreset,
    groupMode,
    setGroupMode,
    visibleColumns,
    setVisibleColumns,
    applySavedView,
  } = viewState

  const activeFilterCount =
    filters.status.length +
    filters.phase.length +
    (filters.assignedTo ? 1 : 0)

  const removeStatusChip = (status: TaskStatus) => {
    setFilters({
      ...filters,
      status: filters.status.filter((s) => s !== status),
    })
  }

  const removePhaseChip = (phase: string) => {
    setFilters({
      ...filters,
      phase: filters.phase.filter((p) => p !== phase),
    })
  }

  return (
    <div className="mb-1 flex h-8 shrink-0 min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto print:hidden">
      {/* Search */}
      <div className="relative min-w-0 flex-1 sm:flex-none sm:w-52">
        <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search schedule items..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <ScheduleFilterPopover
        filters={filters}
        setFilters={setFilters}
        phaseOptions={phaseOptions}
        activeFilterCount={activeFilterCount}
      />

      <Select value={orderMode} onValueChange={handleOrderModeChange}>
        <SelectTrigger
          className="h-8 w-auto shrink-0 text-xs"
          aria-label="Schedule ordering"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="chronological">Chronological</SelectItem>
          <SelectItem value="manual">Manual order</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={preset}
        onValueChange={(value) => {
          const nextPreset = SCHEDULE_VIEW_PRESETS.find(
            (candidate) => candidate === value
          )
          if (nextPreset) setPreset(nextPreset)
        }}
      >
        <SelectTrigger className="h-8 w-auto shrink-0 text-xs" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All dates</SelectItem>
          <SelectItem value="my-items">My items</SelectItem>
          <SelectItem value="past-due">Past due</SelectItem>
          <SelectItem value="next-7">Next 7 days</SelectItem>
          <SelectItem value="next-30">Next 30 days</SelectItem>
          <SelectItem value="next-90">Next 90 days</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={groupMode}
        onValueChange={(value) => {
          const nextGroup = SCHEDULE_GROUP_MODES.find(
            (candidate) => candidate === value
          )
          if (nextGroup) setGroupMode(nextGroup)
        }}
      >
        <SelectTrigger className="h-8 w-auto shrink-0 text-xs" aria-label="Grouping">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No grouping</SelectItem>
          <SelectItem value="phase">By phase</SelectItem>
          <SelectItem value="project">By project</SelectItem>
          <SelectItem value="crew">By crew</SelectItem>
          <SelectItem value="status">By status</SelectItem>
        </SelectContent>
      </Select>

      {view === "list" ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Visible columns
            </p>
            <div className="space-y-1.5">
              {SCHEDULE_LIST_COLUMNS.map((column) => (
                <label
                  key={column}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={visibleColumns.includes(column)}
                    onCheckedChange={() =>
                      setVisibleColumns((current) => toggleListValue(current, column))
                    }
                  />
                  <span className="capitalize">
                    {scheduleColumnLabel(column)}
                  </span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      <ScheduleSavedViewsPopover
        savedViewsState={savedViewsState}
        applySavedView={applySavedView}
      />

      {/* Active filter chips */}
      <div className="hidden sm:flex items-center gap-1 overflow-x-auto min-w-0">
        {filters.status.map((s) => (
          <Badge
            key={s}
            variant="outline"
            className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
            onClick={() => removeStatusChip(s)}
          >
            {STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s}
            <IconX className="size-3" />
          </Badge>
        ))}
        {filters.phase.map((p) => (
          <Badge
            key={p}
            variant="outline"
            className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
            onClick={() => removePhaseChip(p)}
          >
            {p}
            <IconX className="size-3" />
          </Badge>
        ))}
        {filters.assignedTo && (
          <Badge
            variant="outline"
            className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
            onClick={() => setFilters({ ...filters, assignedTo: "" })}
          >
            {filters.assignedTo}
            <IconX className="size-3" />
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground hidden sm:inline tabular-nums">
          {visibleCount} schedule item
          {visibleCount !== 1 ? "s" : ""}
        </span>

        {/* Overflow menu */}
        <ScheduleOverflowMenu {...overflowMenu} />
      </div>
    </div>
  )
}
