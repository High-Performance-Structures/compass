"use client"

/*
 * A job's selection decisions for one audience. Owners and subs get their
 * Selections page here: room filter, print buttons and each DecisionCard
 * inline. Staff work on the dashboard Selections page's "Publish to owner"
 * area (SelectionPublishRooms, with the page's shared filter); this staff
 * view keeps its own filter for previews and fixtures.
 */
import { SearchableCombobox } from "@/components/searchable-combobox"
import * as React from "react"
import type { SelectionWorkspace } from "@/lib/selections/types"
import { ProjectPortalPrintButton } from "@/components/projects/project-portal-print-button"
import { selectionReport } from "@/lib/selections/report"
import type { ReportProject } from "@/lib/print/portal-report"
import { PageHeader } from "@/components/page-header"
import { DecisionCard } from "./selection-decision-card"
import { SelectionPublishRooms } from "./selection-publish-rooms"

const ALL_ROOMS = "__all_rooms__"

export function SelectionDecisionWorkspace({
  workspace,
  reportProject,
}: {
  readonly workspace: SelectionWorkspace
  readonly reportProject?: ReportProject
}): React.ReactElement {
  const [room, setRoom] = React.useState(""),
    [pendingOnly, setPendingOnly] = React.useState(false),
    [search, setSearch] = React.useState("")
  const items = workspace.items.filter(
    (item) =>
      (!room ||
        (workspace.audience === "staff" ? item.currentSpec : item.spec)
          .roomName === room) &&
      (!search.trim() ||
        [
          item.currentSpec.roomName,
          item.currentSpec.name,
          item.currentSpec.manufacturer,
          item.currentSpec.model,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase())) &&
      (workspace.audience === "staff" ||
        !pendingOnly ||
        !item.approvedAt ||
        !item.current ||
        item.requests.some((request) => request.status === "open")),
  )
  return (
    <section aria-label="Selections and decisions" className="min-w-0">
      {workspace.audience !== "staff" && (
        <PageHeader
          title={
            workspace.audience === "sub_vendor"
              ? "Approved selections"
              : "Selections & Decisions"
          }
        />
      )}
      {/* Owners and subs get a short orientation; staff headers carry no explanation line. */}
      {workspace.audience !== "staff" && (
        <p className="-mt-3 mb-5 max-w-3xl text-sm text-muted-foreground">
          {workspace.audience === "owner"
            ? "Choose the details that make this home yours. Review choices by room, request pricing, and approve the exact specification and terms."
            : "Current owner-approved selections for the entire project. Review these before and during construction, and raise conflicts with the project team through an RFI."}
        </p>
      )}
      {reportProject && (
        <div className="mb-4 flex flex-wrap gap-2">
          <ProjectPortalPrintButton
            project={reportProject}
            report={selectionReport(items, workspace.audience, workspace.statusLabels)}
          />
          <ProjectPortalPrintButton
            project={reportProject}
            report={selectionReport(items, workspace.audience, workspace.statusLabels)}
            roomSheets
            label="Print Preview (room sheets)"
          />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Find a selection
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-44 rounded-md border bg-background px-2"
            placeholder="Product or room"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Room
          <SearchableCombobox
            className="h-9 w-48 text-sm"
            // "" means all rooms; the picker needs a non-empty value for it.
            value={room === "" ? ALL_ROOMS : room}
            onValueChange={(value) => setRoom(value === ALL_ROOMS ? "" : value)}
            options={[
              { value: ALL_ROOMS, label: "All rooms" },
              ...[
                ...new Set(
                  workspace.items.map(
                    (item) =>
                      (workspace.audience === "staff"
                        ? item.currentSpec
                        : item.spec
                      ).roomName,
                  ),
                ),
              ].map((value) => ({ value, label: value })),
            ]}
            ariaLabel="Room"
            placeholder="All rooms"
            searchPlaceholder="Search rooms..."
            emptyMessage="No matching rooms."
          />
        </label>
        {workspace.audience === "owner" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(event) => setPendingOnly(event.target.checked)}
            />
            Needs a decision or response
          </label>
        )}
        <span className="text-xs text-muted-foreground">
          {items.length} selections
        </span>
      </div>
      {workspace.audience === "staff" ? (
        <SelectionPublishRooms workspace={workspace} items={items} />
      ) : items.length === 0 ? (
        <p className="border-t py-8 text-sm text-muted-foreground">
          {workspace.items.length > 0
            ? "No selections match these filters."
            : workspace.audience === "owner"
              ? "Your team will publish room-by-room selections here when they are ready for your input."
              : "Owner-approved selections will appear here for everyone assigned to this project once published and approved."}
        </p>
      ) : (
        items.map((item) => (
          <DecisionCard
            key={`${item.id}:${item.revision}`}
            item={item}
            workspace={workspace}
            reportProject={reportProject}
          />
        ))
      )}
    </section>
  )
}
