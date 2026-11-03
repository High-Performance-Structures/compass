"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { getImportedParticipantReviewPage } from "@/app/actions/imported-participant-review"
import { ParticipantReviewDialog, type ReviewAction } from "@/components/contacts/participant-review-dialog"
import { RecordSearchInput, RecordTable } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import { useServerRecordTable } from "@/components/use-server-record-table"
import type { ImportedParticipantReviewRow } from "@/lib/domain/conversations/imported-participant-review"
import { formatDate } from "@/lib/format"
import { projectNumberAndName } from "@/lib/project-display-name"
import type { RecordPage } from "@/lib/record-page"

/**
 * Contacts → Needs review: people on imported conversations the importer
 * could not resolve (a name that matches several contacts, or several names
 * run together). Staff pick the person, split the names, or leave it as is.
 * Nothing here shares a conversation or tells anyone.
 */
export function ParticipantReviewTable({
  initialPage,
  onReviewed,
}: {
  readonly initialPage: RecordPage<ImportedParticipantReviewRow> | null
  readonly onReviewed: () => void
}): React.ReactElement {
  const [reloadToken, setReloadToken] = React.useState(0)
  const [active, setActive] = React.useState<{ readonly row: ImportedParticipantReviewRow; readonly action: ReviewAction } | null>(null)

  const columns = React.useMemo<ColumnDef<ImportedParticipantReviewRow>[]>(() => [
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
      id: "project",
      header: "Project",
      accessorFn: (row) => row.projectName,
      cell: ({ row }) => (
        <Link href={`/dashboard/projects/${encodeURIComponent(row.original.projectId)}`} className="hover:underline">
          {projectNumberAndName({ projectNumber: row.original.projectNumber, name: row.original.projectName }, " - ")}
        </Link>
      ),
    },
    {
      id: "conversation",
      header: "Conversation",
      enableSorting: false,
      accessorFn: (row) => row.channelName ?? "",
      cell: ({ row }) => row.original.channelId ? (
        <Link href={`/dashboard/conversations/${encodeURIComponent(row.original.channelId)}`} className="hover:underline">
          {row.original.channelName ?? "Open conversation"}
        </Link>
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
      header: "Date",
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
            {item.canPick ? <Button type="button" size="sm" variant="outline" onClick={() => setActive({ row: item, action: "pick" })}>Pick person</Button> : null}
            {item.canSplit ? <Button type="button" size="sm" variant="outline" onClick={() => setActive({ row: item, action: "split" })}>Split into people</Button> : null}
            {item.canLeave ? <Button type="button" size="sm" variant="ghost" onClick={() => setActive({ row: item, action: "leave" })}>Leave as is</Button> : null}
          </div>
        )
      },
    },
  ], [])

  const list = useServerRecordTable({
    columns,
    getRowId: (row) => row.id,
    load: getImportedParticipantReviewPage,
    reloadToken,
    initialPage,
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        People on imported conversations who could not be matched exactly. Their conversations stay staff-only; resolving someone here does not share anything.
      </p>
      <RecordSearchInput
        value={list.search}
        onChange={list.setSearch}
        label="Search participants that need review"
        placeholder="Search name or project…"
        className="sm:max-w-md"
      />
      <RecordTable
        table={list.table}
        itemLabel="participants"
        emptyMessage={list.search ? "No participants match this search." : "Every imported participant has been reviewed."}
        state={list.state}
        rowIdPrefix="participant-review"
      />
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
