import type * as React from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import {
  getProjectSelectionOptions,
  getProjectSelections,
  type ProjectSelectionItem,
  type ProjectSelectionOptions,
  type ProjectSelectionsSummary,
} from "@/app/actions/project-selections"
import { getProjects } from "@/app/actions/projects"
import { SelectionPrintPageControls } from "@/components/projects/selection-print-page-controls"
import {
  selectionPacketHtml,
  selectionPrintStyles,
  selectionPublicUrl,
  type SelectionPrintMode,
} from "@/lib/project-selection-print"

export const dynamic = "force-dynamic"

type SelectionFilterState = {
  readonly division: string | null
  readonly costCode: string | null
  readonly roomName: string | null
}

type CostCodeDisplay = {
  readonly divisionCode: string
  readonly label: string
}

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function isProjectNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "Project not found"
}

function projectLabel(
  project:
    | {
        readonly name: string
        readonly projectNumber: string | null
      }
    | undefined
): string {
  if (!project) return "Project"
  return project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name
}

function singleSearchValue(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (Array.isArray(value)) {
    const first = value.find((item) => item.length > 0)
    return first ?? null
  }
  return null
}

function printMode(value: string | null): SelectionPrintMode {
  return value === "room_sheets" ? "room_sheets" : "packet"
}

function buildCostCodeMap(
  options: ProjectSelectionOptions
): ReadonlyMap<string, CostCodeDisplay> {
  return new Map(
    options.costCodes.map((option) => [
      option.value,
      {
        divisionCode: option.divisionCode,
        label: option.label,
      },
    ])
  )
}

function selectionMatchesFilters(
  selection: ProjectSelectionItem,
  filters: SelectionFilterState,
  costCodeMap: ReadonlyMap<string, CostCodeDisplay>
): boolean {
  if (filters.roomName && selection.roomName !== filters.roomName) return false
  if (filters.costCode && selection.costCode !== filters.costCode) return false
  if (filters.division) {
    if (!selection.costCode) return false
    return costCodeMap.get(selection.costCode)?.divisionCode === filters.division
  }

  return true
}

function summarizeFilteredSelections(
  summary: ProjectSelectionsSummary,
  filters: SelectionFilterState,
  costCodeMap: ReadonlyMap<string, CostCodeDisplay>
): ProjectSelectionsSummary {
  const rooms = summary.rooms
    .map((room) => ({
      ...room,
      selections: room.selections.filter((selection) =>
        selectionMatchesFilters(selection, filters, costCodeMap)
      ),
    }))
    .filter((room) => !filters.roomName || room.roomName === filters.roomName)
    .filter((room) => room.selections.length > 0)
    .map((room) => ({
      ...room,
      selectionCount: room.selections.length,
    }))

  const selections = rooms.flatMap((room) => room.selections)

  return {
    totalCount: selections.length,
    roomCount: rooms.length,
    sourceWorkbookCount: new Set(
      rooms
        .map((room) => room.sourceWorkbookId)
        .filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) =>
      ["needed", "proposed", "owner_review", "unavailable"].includes(
        selection.status
      )
    ).length,
    approvedCount: selections.filter((selection) => selection.status === "approved")
      .length,
    pricingCount: selections.filter((selection) =>
      ["pricing", "rfq_sent"].includes(selection.status)
    ).length,
    orderedCount: selections.filter((selection) =>
      ["ordered", "installed"].includes(selection.status)
    ).length,
    rooms,
  }
}

function filterLabel({
  costCodeMap,
  filters,
  options,
}: {
  readonly costCodeMap: ReadonlyMap<string, CostCodeDisplay>
  readonly filters: SelectionFilterState
  readonly options: ProjectSelectionOptions
}): string | null {
  const parts: string[] = []

  if (filters.roomName) parts.push(filters.roomName)
  if (filters.division) {
    parts.push(
      options.divisions.find((option) => option.value === filters.division)
        ?.label ?? filters.division
    )
  }
  if (filters.costCode) {
    parts.push(costCodeMap.get(filters.costCode)?.label ?? filters.costCode)
  }

  return parts.length > 0 ? parts.join(" / ") : null
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers()
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host")
  const protocol = headerList.get("x-forwarded-proto") ?? "https"
  return host ? `${protocol}://${host}` : "https://compass.openrangeconstruction.ltd"
}

export default async function ProjectSelectionsPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >
}): Promise<React.ReactElement> {
  const { id } = await params
  const query = await searchParams
  let summary: ProjectSelectionsSummary
  let options: ProjectSelectionOptions

  try {
    ;[summary, options] = await Promise.all([
      getProjectSelections(id),
      getProjectSelectionOptions(id),
    ])
  } catch (error) {
    if (hasDigest(error)) throw error
    if (isProjectNotFound(error)) notFound()
    throw error
  }

  const filters: SelectionFilterState = {
    costCode: singleSearchValue(query.costCode),
    division: singleSearchValue(query.division),
    roomName: singleSearchValue(query.room),
  }
  const mode = printMode(singleSearchValue(query.mode))
  const costCodeMap = buildCostCodeMap(options)
  const filteredSummary = summarizeFilteredSelections(summary, filters, costCodeMap)
  const projects = await getProjects()
  const project = projects.find((item) => item.id === id)
  const label = projectLabel(project)
  const origin = await requestOrigin()
  const packetHtml = selectionPacketHtml({
    clientName: project?.clientName ?? null,
    filterLabel: filterLabel({ costCodeMap, filters, options }),
    mode,
    projectLabel: label,
    selectionUrl: selectionPublicUrl(id, origin),
    summary: filteredSummary,
  })

  return (
    <>
      <title>{label} Finish Selections</title>
      <style
        dangerouslySetInnerHTML={{
          __html: selectionPrintStyles(),
        }}
      />
      <SelectionPrintPageControls
        backHref={`/dashboard/projects/${id}/selections`}
        documentTitle={`${label} Finish Selections`}
      />
      <article
        className="selection-printable"
        dangerouslySetInnerHTML={{ __html: packetHtml }}
      />
    </>
  )
}
