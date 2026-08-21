"use client"

import * as React from "react"
import { createPortal } from "react-dom"

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
  paletteScopeId,
  projectName,
  projectNumber,
  projects = [],
}: {
  readonly audienceLabel: string
  readonly brand: ProjectBrand | null
  readonly items: readonly SchedulePrintItem[]
  readonly paletteScopeId: string
  readonly projectName: string
  readonly projectNumber?: string | null
  readonly projects?: readonly SchedulePrintProject[]
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
          <p>{audienceLabel}</p>
          <h1>{title}</h1>
          <span>
            {items.length} schedule item{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

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
          {items.map((item) => {
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

      <footer className="schedule-print-footer">
        <span>Printed {new Date().toLocaleDateString()}</span>
        <span>Read-only schedule report</span>
      </footer>
    </section>,
    document.body
  )
}
