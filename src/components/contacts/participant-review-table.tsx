"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { getImportedParticipantReviewPage } from "@/app/actions/imported-participant-review"
import { ParticipantAutoMatchDialog } from "@/components/contacts/participant-auto-match-dialog"
import { ParticipantReviewDialog, type ReviewAction } from "@/components/contacts/participant-review-dialog"
import { RecordSearchInput, RecordTable } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import { useServerRecordTable } from "@/components/use-server-record-table"
import type { ImportedParticipantReviewRow } from "@/lib/domain/conversations/imported-participant-review"
import { formatDate } from "@/lib/format"
import { projectNumberAndName } from "@/lib/project-display-name"
import type { RecordPage, RecordPageQuery } from "@/lib/record-page"

/** The contacts review sheet's columns (sheet "contacts.review"). */
export function participantReviewColumns(
  onAction: (row: ImportedParticipantReviewRow, action: ReviewAction) => void,
): ColumnDef<ImportedParticipantReviewRow>[] {
  return [
    {
      id: "literal",
      header: "As written",
      accessorFn: (row) => row.literal,
      cell: ({ row }) => (
        <div className="min-w-0 max-w-md">
          <span className="block break-words font-medium">{row.original.literal}</span>
          <span className="block text-xs text-muted-foreground">{row.original.role}</span>
        </div>
      ),
    },
    { id: "reason", header: "Reason", enableSorting: false, accessorFn: (row) => row.reason },
    {
      id: "projects",
      header: "Projects",
      accessorFn: (row) => row.projectCount,
      cell: ({ row }) => row.original.projectCount === 1 ? (
        <Link href={`/dashboard/projects/${encodeURIComponent(row.original.projectId)}`} className="hover:underline">
          {projectNumberAndName({ projectNumber: row.original.projectNumber, name: row.original.projectName }, " - ")}
        </Link>
      ) : (
        <span className="tabular-nums">{row.original.projectCount} projects</span>
      ),
    },
    {
      id: "conversation",
      header: "Conversations",
      enableSorting: false,
      accessorFn: (row) => row.conversationCount,
      cell: ({ row }) => row.original.channelId ? (
        <Link href={`/dashboard/conversations/${encodeURIComponent(row.original.channelId)}`} className="hover:underline">
          {row.original.channelName ?? "Open conversation"}
        </Link>
      ) : row.original.conversationCount > 1 ? (
        <span className="tabular-nums">{row.original.conversationCount}</span>
      ) : <span className="text-muted-foreground">Not found</span>,
    },
    {
      id: "messages",
      header: "Messages",
      accessorFn: (row) => row.messageCount,
      cell: ({ row }) => <span className="tabular-nums">{row.original.messageCount}</span>,
    },
    {
      id: "date",
      header: "Last message",
      accessorFn: (row) => row.lastAt ?? "",
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.lastAt ? formatDate(row.original.lastAt) : ""}</span>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original
        if (item.readOnlyReason) return <span className="text-xs text-muted-foreground" title={item.readOnlyReason}>Read only</span>
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {item.canPick ? <Button type="button" size="sm" variant="outline" onClick={() => onAction(item, "pick")}>Pick person</Button> : null}
            {item.canSplit ? <Button type="button" size="sm" variant="outline" onClick={() => onAction(item, "split")}>Split into people</Button> : null}
            {item.canLeave ? <Button type="button" size="sm" variant="ghost" onClick={() => onAction(item, "leave")}>Leave as is</Button> : null}
          </div>
        )
      },
    },
  ]
}

/**
 * Contacts → Needs review: people on imported conversations the importer
 * could not resolve, one row per name or email across every project. Admins
 * can match the clear ones automatically; staff pick the person, split names
 * run together, or leave it as is, and one choice covers every row of the
 * name. Nothing here shares a conversation or tells anyone.
 */
export function ParticipantReviewTable({
  initialPage,
  initialQuery,
  onReviewed,
  canAutoMatch = false,
}: {
  readonly initialPage: RecordPage<ImportedParticipantReviewRow> | null
  /** Admins may run automatic matching. */
  readonly canAutoMatch?: boolean
  /** The query the server read `initialPage` with. */
  readonly initialQuery?: RecordPageQuery
  readonly onReviewed: () => void
}): React.ReactElement {
  const [reloadToken, setReloadToken] = React.useState(0)
  const [autoOpen, setAutoOpen] = React.useState(false)
  const [active, setActive] = React.useState<{ readonly row: ImportedParticipantReviewRow; readonly action: ReviewAction } | null>(null)

  const columns = React.useMemo(() => participantReviewColumns((row, action) => setActive({ row, action })), [])

  const list = useServerRecordTable({
    columns,
    getRowId: (row) => row.id,
    load: getImportedParticipantReviewPage,
    reloadToken,
    initialPage,
    initialQuery,
    sheetId: "contacts.review",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        People on imported conversations who could not be matched exactly, one row per name or email across every project. Your choice applies to every message that names them. Their conversations stay staff-only; resolving someone here does not share anything.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <RecordSearchInput
          value={list.search}
          onChange={list.setSearch}
          label="Search participants that need review"
          placeholder="Search name, email or project…"
          className="sm:max-w-md"
        />
        {canAutoMatch ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setAutoOpen(true)}>Match automatically…</Button>
        ) : null}
      </div>
      <RecordTable
        table={list.table}
        itemLabel="names"
        emptyMessage={list.search ? "No participants match this search." : "Every imported participant has been reviewed."}
        state={list.state}
        rowIdPrefix="participant-review"
      />
      {canAutoMatch ? (
        <ParticipantAutoMatchDialog
          open={autoOpen}
          onOpenChange={setAutoOpen}
          onDone={() => {
            setReloadToken((value) => value + 1)
            onReviewed()
          }}
        />
      ) : null}
      <ParticipantReviewDialog
        row={active?.row ?? null}
        action={active?.action ?? "leave"}
        onOpenChange={(open) => { if (!open) setActive(null) }}
        onReviewed={() => {
          setReloadToken((value) => value + 1)
          onReviewed()
        }}
      />
    </div>
  )
}
