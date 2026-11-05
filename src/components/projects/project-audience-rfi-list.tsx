"use client"

import * as React from "react"

import { ProjectPortalPrintButton } from "@/components/projects/project-portal-print-button"
import { ProjectRfiRecordTable } from "@/components/projects/project-rfi-record-table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { rfiReport } from "@/lib/print/audience-record-reports"
import type { ReportProject } from "@/lib/print/portal-report"
import type { AudienceRfi } from "@/lib/project-audience-preview-types"
import { isClosedRfiStatus } from "@/lib/rfis/status"
import { rfiListRow, rfiStatusLabel, selectedRfiIdFromLocation, type RfiListRow } from "@/lib/rfis/record-list"

/** The selected RFI, read-only, as vendors saw it before the table. */
function AudienceRfiCard({
  item,
  project,
}: {
  readonly item: AudienceRfi
  readonly project: ReportProject
}): React.ReactElement {
  return (
    <article id={`rfi-${item.id}`} className="scroll-mt-24 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{item.rfiNumber}</p>
          <h3 className="mt-1 text-sm font-medium">{item.subject}</h3>
        </div>
        <div className="flex flex-wrap gap-1">
          <ProjectPortalPrintButton project={project} report={rfiReport([item])} />
          <Badge variant={isClosedRfiStatus(item.status) ? "outline" : "secondary"}>
            {rfiStatusLabel(item.status)}
          </Badge>
          {item.priority === "high" && <Badge>High</Badge>}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.question}</p>
      {item.answer && <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{item.answer}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {item.companyName && <span>{item.companyName}</span>}
        {item.assignedToName && <span>Assigned: {item.assignedToName}</span>}
        {item.dueDate && <span>Due {formatDate(item.dueDate)}</span>}
      </div>
    </article>
  )
}

/**
 * The sub/vendor RFI list: the shared record table, read-only. A row (or a
 * `?item=` / `#rfi-` link) opens that RFI below the table.
 */
export function ProjectAudienceRfiList({
  rfis,
  project,
}: {
  readonly rfis: readonly AudienceRfi[]
  readonly project: ReportProject
}): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const rows = React.useMemo(() => rfis.map(rfiListRow), [rfis])
  const selected = rfis.find((item) => item.id === selectedId) ?? null

  // Deep links (dashboard, notifications) name the RFI in the URL.
  React.useEffect(() => {
    const fromLocation = selectedRfiIdFromLocation(
      window.location.search,
      window.location.hash,
      rfis.map((item) => item.id),
    )
    if (fromLocation) setSelectedId(fromLocation)
  }, [rfis])

  React.useEffect(() => {
    if (!selectedId) return
    document.getElementById(`rfi-${selectedId}`)?.scrollIntoView({ block: "start" })
  }, [selectedId])

  const onSelect = React.useCallback((row: RfiListRow) => {
    setSelectedId(row.id)
    // Keep the open RFI in the URL so it can be shared or reloaded.
    const url = new URL(window.location.href)
    url.searchParams.set("item", row.id)
    url.hash = `rfi-${row.id}`
    window.history.replaceState(window.history.state, "", url)
  }, [])

  return (
    <div className="mt-4 space-y-4">
      <ProjectRfiRecordTable
        rows={rows}
        audience="vendor"
        onSelect={onSelect}
        selectedId={selectedId}
        emptyMessage="No RFIs are currently visible for this project."
      />
      {selected ? (
        <AudienceRfiCard item={selected} project={project} />
      ) : rfis.length > 0 ? (
        <p className="text-sm text-muted-foreground">Select an RFI to see its question and response.</p>
      ) : null}
    </div>
  )
}
