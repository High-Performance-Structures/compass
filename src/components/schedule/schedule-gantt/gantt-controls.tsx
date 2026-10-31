"use client"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  IconSettings,
  IconZoomIn,
  IconZoomOut,
  IconCalendar,
} from "@tabler/icons-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { VIEW_MODES, type ViewMode } from "./gantt-view-rules"

/** Items/Chart switch on phones, time scale, zoom, help and settings. */
export function GanttControls({
  isMobile,
  mobileView,
  setMobileView,
  viewMode,
  handleViewModeChange,
  scrollToToday,
  handleZoom,
  phaseGrouping,
  setPhaseGrouping,
  onGroupByPhaseChange,
  showCriticalPath,
  setShowCriticalPath,
}: {
  readonly isMobile: boolean
  readonly mobileView: "tasks" | "chart"
  readonly setMobileView: (view: "tasks" | "chart") => void
  readonly viewMode: ViewMode
  readonly handleViewModeChange: (mode: ViewMode) => void
  readonly scrollToToday: () => void
  readonly handleZoom: (direction: "in" | "out") => void
  readonly phaseGrouping: boolean
  readonly setPhaseGrouping: (grouped: boolean) => void
  readonly onGroupByPhaseChange?: (grouped: boolean) => void
  readonly showCriticalPath: boolean
  readonly setShowCriticalPath: (show: boolean) => void
}) {
  return (
    <div
      className="mb-1 flex h-8 shrink-0 items-center"
      data-gantt-controls
    >
      <div className="flex items-center gap-1">
        {isMobile && (
          <Select
            value={mobileView}
            onValueChange={(value) => {
              if (value === "tasks" || value === "chart") setMobileView(value)
            }}
          >
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chart">Chart</SelectItem>
              <SelectItem value="tasks">Items</SelectItem>
            </SelectContent>
          </Select>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Gantt controls"
              className="h-8 px-2 text-xs"
              size="sm"
              variant="outline"
            >
              <IconCalendar className="size-3.5" />
              <span className="ml-1.5">{viewMode}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={viewMode}
              onValueChange={(value) => {
                const mode = VIEW_MODES.find((candidate) => candidate === value)
                if (mode) handleViewModeChange(mode)
              }}
            >
              {VIEW_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {mode}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={scrollToToday}>Today</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => handleZoom("out")}
          title="Zoom out"
        >
          <IconZoomOut className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => handleZoom("in")}
          title="Zoom in"
        >
          <IconZoomIn className="size-3.5" />
        </Button>

        <ContextualHelpBeacon topicId="schedule.gantt" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Gantt settings"
              variant="ghost"
              size="icon"
              className="size-7"
            >
              <IconSettings className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="space-y-2 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs">Group by Phase</span>
                <Switch
                  checked={phaseGrouping}
                  onCheckedChange={(checked) => {
                    setPhaseGrouping(checked)
                    onGroupByPhaseChange?.(checked)
                  }}
                  className="scale-75"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">Critical Path View</span>
                <Switch
                  checked={showCriticalPath}
                  onCheckedChange={setShowCriticalPath}
                  className="scale-75"
                />
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
