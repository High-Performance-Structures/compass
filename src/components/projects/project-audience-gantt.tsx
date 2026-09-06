"use client"

import * as React from "react"
import { IconCalendar, IconMinus, IconPlus } from "@tabler/icons-react"
import type { AudienceScheduleItem } from "@/app/actions/project-audience-preview"
import {
  GanttChart,
  type GanttScrollPosition
} from "@/components/schedule/gantt-chart"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable"
import { useIsMobile } from "@/hooks/use-mobile"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import {
  getScheduleItemDisplayColor,
  normalizeDisplayColor
} from "@/lib/schedule/appearance"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import type { WorkdayExceptionData } from "@/lib/schedule/types"
import { ScheduleItemResponses } from "./schedule-item-responses"

type ViewMode = "Day" | "Week" | "Month" | "Year"
const WIDTHS: Readonly<Record<ViewMode, number>> = {
  Day: 38,
  Week: 140,
  Month: 120,
  Year: 160
}
const MODES: readonly ViewMode[] = ["Day", "Week", "Month", "Year"]
const NO_EXCEPTIONS: readonly WorkdayExceptionData[] = []

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

export function ProjectAudienceGantt({
  items,
  projectId
}: {
  readonly items: readonly AudienceScheduleItem[]
  readonly projectId: string
}): React.ReactElement {
  const palette = useScheduleDisplayPalette(projectId)
  const mobile = useIsMobile()
  const [mobileView, setMobileView] = React.useState<"chart" | "items">("chart")
  const [mode, setMode] = React.useState<ViewMode>("Week")
  const [width, setWidth] = React.useState(WIDTHS.Week)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selected = items.find((item) => item.id === selectedId)
  const listRef = React.useRef<HTMLDivElement>(null)
  const chartRef = React.useRef<HTMLElement | null>(null)
  const dateScroll = React.useRef<((date: string) => void) | null>(null)
  const todayScroll = React.useRef<(() => void) | null>(null)
  const position = React.useRef<GanttScrollPosition>({ left: 0, top: 0 })
  const tasks = React.useMemo<FrappeTask[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        name: item.title,
        start: item.startDate,
        end: item.endDate,
        progress: item.percentComplete,
        dependencies: "",
        custom_class: `display-color-${normalizeDisplayColor(item.displayColor)}`,
        displayColor: item.displayColor,
        isCriticalPath: false,
        isMilestone: item.isMilestone
      })),
    [items]
  )

  const zoom = React.useCallback((direction: "in" | "out") => {
    setWidth((current) =>
      Math.round(
        Math.min(
          300,
          Math.max(20, direction === "in" ? current * 1.3 : current / 1.3)
        )
      )
    )
  }, [])
  const chartScrolled = React.useCallback((next: GanttScrollPosition) => {
    position.current = next
    // Both panes use the same 85px header and 48px rows; synchronize pixels.
    if (listRef.current && Math.abs(listRef.current.scrollTop - next.top) > 1) {
      listRef.current.scrollTop = next.top
    }
  }, [])
  const openItem = (item: AudienceScheduleItem): void => {
    dateScroll.current?.(item.startDate)
    setSelectedId(item.id)
  }
  const chart = (
    <GanttChart
      tasks={tasks}
      exceptions={NO_EXCEPTIONS}
      viewMode={mode}
      columnWidth={width}
      readOnly
      displayColorPalette={palette}
      onZoom={zoom}
      onTaskClick={(task) => {
        const item = items.find((candidate) => candidate.id === task.id)
        if (item) openItem(item)
      }}
      onContainerReady={(container) => {
        chartRef.current = container
        if (!container) return
        const saved = position.current
        requestAnimationFrame(() => {
          if (chartRef.current !== container) return
          const today = new Date().toLocaleDateString("en-CA")
          const first = items[0]
          const last = items.reduce<string>(
            (end, item) => (item.endDate > end ? item.endDate : end),
            ""
          )
          const initial =
            first && (today < first.startDate || today > last)
              ? first.startDate
              : today
          dateScroll.current?.(saved.anchorDate ?? initial)
          container.scrollTop = saved.top
          if (listRef.current) listRef.current.scrollTop = saved.top
        })
      }}
      onScrollPositionChange={chartScrolled}
      onDateScrollReady={(handler) => {
        dateScroll.current = handler
      }}
      onTodayScrollReady={(handler) => {
        todayScroll.current = handler
      }}
    />
  )
  const table = (
    <div
      ref={listRef}
      className="schedule-gantt-task-list h-full overflow-auto"
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop
        if (chartRef.current && Math.abs(chartRef.current.scrollTop - top) > 1)
          chartRef.current.scrollTop = top
      }}
    >
      <table
        className="w-full table-fixed text-xs"
        aria-label="Published schedule items"
      >
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="h-[85px] border-b text-left text-muted-foreground">
            <th className="px-3 font-medium">Item</th>
            <th className="w-20 px-2 font-medium">Start</th>
            <th className="w-12 px-2 text-right font-medium">Days</th>
            <th className="w-14 px-2 text-right font-medium">Done</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="h-[48px] border-b even:bg-muted/20 hover:bg-muted/50"
            >
              <td className="h-[48px] px-3 py-0">
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex h-full w-full min-w-0 items-center gap-2 text-left focus-visible:outline-ring"
                  title={item.title}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: getScheduleItemDisplayColor(
                        item,
                        palette
                      )
                    }}
                  />
                  <span className="truncate font-medium">{item.title}</span>
                </button>
              </td>
              <td className="px-2 tabular-nums text-muted-foreground">
                {new Date(`${item.startDate}T12:00:00`).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric" }
                )}
              </td>
              <td className="px-2 text-right tabular-nums text-muted-foreground">
                {item.isMilestone ? "—" : item.workdays}
              </td>
              <td className="px-2 text-right tabular-nums text-muted-foreground">
                {item.percentComplete}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Match Frappe’s 8px grid tail so the final rows stay aligned too. */}
      <div aria-hidden="true" className="h-2" />
    </div>
  )

  return (
    <div className="min-w-0 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {mobile && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() =>
              setMobileView((value) => (value === "chart" ? "items" : "chart"))
            }
          >
            {mobileView === "chart" ? "Show items" : "Show chart"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              aria-label="Gantt controls"
            >
              <IconCalendar className="size-3.5" />
              {mode}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => {
                const next = MODES.find((candidate) => candidate === value)
                if (next) {
                  setMode(next)
                  setWidth(WIDTHS[next])
                }
              }}
            >
              {MODES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {value}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Zoom out"
          disabled={width <= 20}
          onClick={() => zoom("out")}
        >
          <IconMinus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Zoom in"
          disabled={width >= 300}
          onClick={() => zoom("in")}
        >
          <IconPlus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => todayScroll.current?.()}
        >
          Today
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          Select an item for details and responses
        </p>
      </div>
      <div
        className="h-[min(60vh,600px)] min-h-[320px] overflow-hidden border"
        aria-label="Published project Gantt chart"
      >
        {mobile ? (
          mobileView === "chart" ? (
            chart
          ) : (
            table
          )
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="35%" minSize="25%">
              {table}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="65%" minSize="40%">
              {chart}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
            <DialogDescription>Published schedule item</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <dl className="grid grid-cols-2 gap-4 border-y py-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Dates</dt>
                  <dd className="mt-1">
                    {formatDate(selected.startDate)} –{" "}
                    {formatDate(selected.endDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Duration</dt>
                  <dd className="mt-1">
                    {selected.isMilestone
                      ? "Milestone"
                      : `${selected.workdays} workdays`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Assigned to</dt>
                  <dd className="mt-1">{selected.assignedTo ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Progress</dt>
                  <dd className="mt-1">{selected.percentComplete}% complete</dd>
                </div>
              </dl>
              <ScheduleItemResponses key={selected.id} item={selected} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
