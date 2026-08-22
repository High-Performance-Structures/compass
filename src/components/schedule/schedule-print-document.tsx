"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
} from "date-fns"

import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import type { ProjectBrand } from "@/lib/project-branding"
import { requiresSynchronousPrint } from "@/lib/print/ios-print"
import {
  IOS_PRINT_STATE_TIMEOUT_MS,
  PRINT_STATE_TIMEOUT_MS,
  waitForPrintLayout,
} from "@/lib/print/readiness"
import { getScheduleItemDisplayColor } from "@/lib/schedule/appearance"
import {
  filterScheduleItemsForPrint,
  type SchedulePrintDateRange,
  type SchedulePrintLayout,
} from "@/lib/schedule/print-range"
import { cn } from "@/lib/utils"

export type SchedulePrintItem = {
  readonly id: string
  readonly projectId?: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly workdays: number
  readonly status: string
  readonly phase: string
  readonly displayColor: string | null
  readonly assignedTo: string | null
  readonly percentComplete: number
  readonly isMilestone: boolean
}

type SchedulePrintProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function projectLabel(project: SchedulePrintProject): string {
  return project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name
}

function formatRange(range: SchedulePrintDateRange): string {
  return `${format(parseISO(range.start), "MMM d, yyyy")} – ${format(parseISO(range.end), "MMM d, yyyy")}`
}

function statusClassName(status: string): string {
  if (status === "COMPLETE") return "schedule-print-task-complete"
  if (status === "IN_PROGRESS") return "schedule-print-task-progress"
  if (status === "BLOCKED") return "schedule-print-task-blocked"
  return "schedule-print-task-pending"
}

function SchedulePrintGantt({
  colorFor,
  items,
  range,
}: {
  readonly colorFor: (item: SchedulePrintItem) => string
  readonly items: readonly SchedulePrintItem[]
  readonly range: SchedulePrintDateRange
}): React.ReactElement {
  const rangeStart = parseISO(range.start)
  const totalDays =
    differenceInCalendarDays(parseISO(range.end), rangeStart) + 1
  const tickStep = totalDays <= 14 ? 1 : totalDays <= 62 ? 7 : 30
  const ticks = Array.from(
    { length: Math.ceil(totalDays / tickStep) },
    (_, index) => addDays(rangeStart, index * tickStep)
  )

  return (
    <section className="schedule-print-gantt">
      <div className="schedule-print-gantt-header">
        <div>Schedule item</div>
        <div className="schedule-print-timeline-header">
          {ticks.map((date) => {
            const left =
              (differenceInCalendarDays(date, rangeStart) / totalDays) * 100
            const label =
              totalDays <= 14
                ? "EEE M/d"
                : totalDays <= 62
                  ? "M/d"
                  : "MMM yyyy"
            return (
              <span key={date.toISOString()} style={{ left: `${left}%` }}>
                {format(date, label)}
              </span>
            )
          })}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="schedule-print-empty">
          No schedule items overlap this timeframe.
        </p>
      ) : (
        items.map((item) => {
          const clippedStart =
            item.startDate < range.start ? range.start : item.startDate
          const clippedEnd =
            item.endDate > range.end ? range.end : item.endDate
          const left =
            (differenceInCalendarDays(parseISO(clippedStart), rangeStart) /
              totalDays) *
            100
          const width =
            ((differenceInCalendarDays(
              parseISO(clippedEnd),
              parseISO(clippedStart)
            ) +
              1) /
              totalDays) *
            100
          return (
            <div className="schedule-print-gantt-row" key={item.id}>
              <div className="schedule-print-task-label">
                <strong>{item.title}</strong>
                <span>
                  {formatDate(item.startDate)} – {formatDate(item.endDate)}
                </span>
              </div>
              <div className="schedule-print-timeline-row">
                <div
                  className={cn(
                    "schedule-print-bar",
                    statusClassName(item.status)
                  )}
                  style={{
                    backgroundColor: colorFor(item),
                    left: `${left}%`,
                    width: `${Math.max(width, 0.6)}%`,
                  }}
                >
                  {width >= 12 ? item.title : ""}
                </div>
              </div>
            </div>
          )
        })
      )}
    </section>
  )
}

function SchedulePrintCalendar({
  colorFor,
  items,
  range,
}: {
  readonly colorFor: (item: SchedulePrintItem) => string
  readonly items: readonly SchedulePrintItem[]
  readonly range: SchedulePrintDateRange
}): React.ReactElement {
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(parseISO(range.start)),
    end: endOfWeek(parseISO(range.end)),
  })
  const weeks: Date[][] = []
  for (let index = 0; index < calendarDays.length; index += 7) {
    weeks.push(calendarDays.slice(index, index + 7))
  }

  return (
    <section className="schedule-print-calendar">
      <div className="schedule-print-weekdays">
        {[
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div className="schedule-print-week" key={week[0].toISOString()}>
          {week.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd")
            const inRange = dateKey >= range.start && dateKey <= range.end
            const dayItems = items.filter(
              (item) =>
                item.startDate <= dateKey && item.endDate >= dateKey
            )
            return (
              <div
                className={cn(
                  "schedule-print-day",
                  !inRange && "schedule-print-day-outside"
                )}
                key={dateKey}
              >
                <strong>{format(day, "MMM d")}</strong>
                <div className="schedule-print-day-items">
                  {inRange &&
                    dayItems.map((item) => (
                      <div
                        className={cn(
                          "schedule-print-calendar-item",
                          statusClassName(item.status)
                        )}
                        key={item.id}
                        style={{ borderLeftColor: colorFor(item) }}
                      >
                        {item.title}
                      </div>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}

export async function printScheduleDocument(): Promise<void> {
  const printRoot = document.querySelector(
    '[data-project-schedule-print-document="true"]'
  )
  if (!(printRoot instanceof HTMLElement)) {
    window.print()
    return
  }

  document.body.classList.add("schedule-printing")
  const resetPrintState = (): void => {
    document.body.classList.remove("schedule-printing")
    window.removeEventListener("afterprint", resetPrintState)
  }

  if (requiresSynchronousPrint(window.navigator)) {
    window.print()
    window.setTimeout(resetPrintState, IOS_PRINT_STATE_TIMEOUT_MS)
    return
  }

  window.addEventListener("afterprint", resetPrintState)
  await waitForPrintLayout(printRoot)
  window.print()
  window.setTimeout(resetPrintState, PRINT_STATE_TIMEOUT_MS)
}

export function SchedulePrintDocument({
  audienceLabel,
  brand,
  items,
  layout = "list",
  paletteScopeId,
  projectName,
  projectNumber,
  projects = [],
  range,
}: {
  readonly audienceLabel: string
  readonly brand: ProjectBrand | null
  readonly items: readonly SchedulePrintItem[]
  readonly layout?: SchedulePrintLayout
  readonly paletteScopeId: string
  readonly projectName: string
  readonly projectNumber?: string | null
  readonly projects?: readonly SchedulePrintProject[]
  readonly range?: SchedulePrintDateRange
}): React.ReactElement | null {
  const [mounted, setMounted] = React.useState(false)
  const displayColorPalette = useScheduleDisplayPalette(paletteScopeId)
  const projectById = React.useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )

  React.useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const title = projectNumber
    ? `${projectNumber} · ${projectName}`
    : projectName
  const printableItems = range
    ? filterScheduleItemsForPrint(items, range)
    : items
  const colorFor = (item: SchedulePrintItem): string =>
    getScheduleItemDisplayColor(item, displayColorPalette)

  return createPortal(
    <section
      className="schedule-print-document"
      data-project-schedule-print-document="true"
    >
      <header className="schedule-print-header">
        <div className="schedule-print-brand">
          {brand && (
            <ProjectBrandLogo
              brand={brand}
              size={52}
              className="schedule-print-logo"
            />
          )}
          <div>
            <p className="schedule-print-company">
              {brand?.companyName ?? "Compass"}
            </p>
            {brand && (
              <ProjectBrandContactDetails
                brand={brand}
                lineClassName="schedule-print-contact-line"
              />
            )}
          </div>
        </div>
        <div className="schedule-print-title">
          <p>
            {audienceLabel} · {formatLabel(layout)}
          </p>
          <h1>{title}</h1>
          <span>
            {range ? `${formatRange(range)} · ` : ""}
            {printableItems.length} schedule item
            {printableItems.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {layout === "gantt" && range ? (
        <SchedulePrintGantt
          colorFor={colorFor}
          items={printableItems}
          range={range}
        />
      ) : layout === "calendar" && range ? (
        <SchedulePrintCalendar
          colorFor={colorFor}
          items={printableItems}
          range={range}
        />
      ) : (
      <table className="schedule-print-table">
        <thead>
          <tr>
            <th>Schedule item</th>
            {projects.length > 1 && <th>Project</th>}
            <th>Phase</th>
            <th>Start</th>
            <th>Finish</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Assigned to</th>
          </tr>
        </thead>
        <tbody>
          {printableItems.map((item) => {
            const itemProject = item.projectId
              ? projectById.get(item.projectId)
              : undefined
            return (
              <tr key={item.id}>
                <td>
                  <span
                    className="schedule-print-color"
                    style={{
                      backgroundColor: getScheduleItemDisplayColor(
                        item,
                        displayColorPalette
                      ),
                    }}
                  />
                  <span>{item.title}</span>
                </td>
                {projects.length > 1 && (
                  <td>{itemProject ? projectLabel(itemProject) : "—"}</td>
                )}
                <td>{formatLabel(item.phase)}</td>
                <td>{formatDate(item.startDate)}</td>
                <td>{formatDate(item.endDate)}</td>
                <td>{item.isMilestone ? "Milestone" : `${item.workdays} wd`}</td>
                <td>
                  {formatLabel(item.status)} · {item.percentComplete}%
                </td>
                <td>{item.assignedTo ?? "—"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}

      <footer className="schedule-print-footer">
        <span>Printed {new Date().toLocaleDateString()}</span>
        <span>Read-only schedule report</span>
      </footer>
    </section>,
    document.body
  )
}
