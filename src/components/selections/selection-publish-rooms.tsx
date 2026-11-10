"use client"

/*
 * Staff "Publish to owner": selections grouped by room, folded to one line
 * each (room, count, "3 waiting on owner" / "all approved" / late risk).
 * Each row has a batch-publish checkbox; clicking it opens the selection's
 * decision (terms, publish form, quote / PO links, requests, history) in the
 * record drawer instead of expanding the list. Owners and subs never see
 * this; their page renders DecisionCard inline.
 */
import * as React from "react"

import { FoldedGroup, FoldedGroupsToolbar, useFoldedGroups } from "@/components/folded-groups"
import { RecordDrawer } from "@/components/record-drawer"
import type { SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import type { SelectionDecisionItem, SelectionWorkspace } from "@/lib/selections/types"
import { groupByRoom, publishRoomPills } from "@/lib/selections/work-filter"
import { SelectionBatchPublish, useSelectionBatch, type SelectionBatchState } from "./selection-batch-publish"
import { DecisionCard } from "./selection-decision-card"

function needsAttention(item: SelectionDecisionItem): boolean {
  return !item.approvedAt || !item.current || item.requests.some((request) => request.status === "open")
}

function rowStatus(item: SelectionDecisionItem): string {
  return !item.published
    ? "Unpublished"
    : !item.current
      ? "Revision needed"
      : item.approvedAt
        ? "Owner approved"
        : "Published for owner"
}

function PublishRow({
  item,
  workspace,
  batch,
  late,
  onOpen,
}: {
  readonly item: SelectionDecisionItem
  readonly workspace: SelectionWorkspace
  readonly batch: SelectionBatchState
  readonly late: boolean
  readonly onOpen: () => void
}): React.ReactElement {
  const pendingRequests = item.requests.filter((request) => request.status === "open").length
  const action = !workspace.canWrite ? "Review" : item.published ? "Manage owner view" : "Publish to owner"
  return (
    <div className="flex items-center gap-3 border-t px-3 first:border-t-0">
      {workspace.canWrite && (
        <input
          type="checkbox"
          aria-label={`Select ${item.currentSpec.roomName}: ${item.currentSpec.name}`}
          checked={!item.published && batch.selected.has(item.id)}
          disabled={batch.pending || item.published}
          onChange={(event) => batch.toggle(item.id, event.target.checked)}
        />
      )}
      <button
        type="button"
        disabled={batch.pending}
        // Same names as the old inline rows, so links and checks still find them.
        aria-label={`${!workspace.canWrite ? "Review" : item.published ? "Manage owner view for" : "Publish to owner —"} ${item.currentSpec.roomName}: ${item.currentSpec.name}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 py-2.5 text-left text-sm"
      >
        <span className="min-w-0">
          <span className="font-medium">{item.currentSpec.name}</span>
          {item.currentSpec.category && (
            <span className="text-muted-foreground"> · {item.currentSpec.category}</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {late && <span className="font-medium text-destructive">Late risk · </span>}
          {pendingRequests > 0 ? `${pendingRequests} owner requests · ` : ""}
          {rowStatus(item)} ·{" "}
          <span className="inline-flex rounded-md border px-2 py-1 font-medium text-primary">{action} →</span>
        </span>
      </button>
    </div>
  )
}

export function SelectionPublishRooms({
  workspace,
  items,
  leadTimeWarnings = [],
}: {
  readonly workspace: SelectionWorkspace
  /** The items the shared filter shows. */
  readonly items: readonly SelectionDecisionItem[]
  readonly leadTimeWarnings?: readonly SelectionLeadTimeWarning[]
}): React.ReactElement {
  const batch = useSelectionBatch(workspace.projectId)
  const folds = useFoldedGroups()
  const [pendingOnly, setPendingOnly] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const lateRisk = React.useMemo(
    () => new Set(leadTimeWarnings.map((warning) => warning.selectionId)),
    [leadTimeWarnings]
  )
  const shown = pendingOnly ? items.filter(needsAttention) : items
  const groups = groupByRoom(shown, (item) => item.currentSpec.roomName)
  // Read from the workspace so the drawer shows fresh terms after a save.
  const openItem = openId ? workspace.items.find((item) => item.id === openId) ?? null : null

  return (
    <section aria-label="Publish to owner" className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        {workspace.items.filter((item) => item.published).length} visible to owner ·{" "}
        {workspace.items.filter((item) => !item.published).length} unpublished.
        {workspace.canWrite
          ? " Open a selection to set its allowance, price and due date and publish it, or tick several and publish them together."
          : " You have view-only access. A project teammate with selection editing permission can publish items."}
      </p>
      {workspace.canWrite && <SelectionBatchPublish state={batch} items={workspace.items} shown={shown} />}
      <FoldedGroupsToolbar state={folds} keys={groups.map((group) => group.roomName)}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} />
          Needs a decision or response
        </label>
        <span className="self-center text-xs text-muted-foreground">{shown.length} selections</span>
      </FoldedGroupsToolbar>
      {groups.length === 0 ? (
        <p className="border-t py-8 text-sm text-muted-foreground">
          {workspace.items.length > 0
            ? "No selections match these filters."
            : "Add a finish selection in the Selection sheet, then publish it here for the owner."}
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <FoldedGroup
              key={group.roomName}
              title={group.roomName}
              count={group.items.length}
              pills={publishRoomPills(group.items, lateRisk)}
              open={folds.isOpen(group.roomName)}
              onToggle={() => folds.toggle(group.roomName)}
            >
              {group.items.map((item) => (
                <PublishRow
                  key={item.id}
                  item={item}
                  workspace={workspace}
                  batch={batch}
                  late={lateRisk.has(item.id)}
                  onOpen={() => setOpenId(item.id)}
                />
              ))}
            </FoldedGroup>
          ))}
        </div>
      )}
      <RecordDrawer
        open={openItem !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null)
        }}
        title={openItem ? openItem.currentSpec.name : "Selection"}
        hideHeader
      >
        {openItem && (
          <fieldset disabled={batch.pending}>
            <DecisionCard item={openItem} workspace={workspace} />
          </fieldset>
        )}
      </RecordDrawer>
    </section>
  )
}
