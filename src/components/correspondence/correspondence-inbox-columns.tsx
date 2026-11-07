"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { SourceTag } from "@/components/shared/source-tag"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  conversationActivityAt,
  conversationActivitySortValue,
  conversationExcerpt,
  conversationStatusChips,
  conversationStatusSortValue,
  conversationType,
  conversationTypeLabel,
  conversationWith,
  type ConversationStatusChip,
} from "@/lib/correspondence/record-list"
import type { CorrespondenceInboxFilter, CorrespondenceSummary } from "@/lib/correspondence/types"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export type InboxSearchHit = {
  readonly conversationId: string
  readonly messageId: string
  readonly subject: string
  readonly excerpt: string
  readonly sentAt: string
  readonly sourceSentDisplay?: string | null
  readonly sourceSentAt?: string | null
}

export type InboxColumnOptions = {
  readonly filter: CorrespondenceInboxFilter
  /** True while a message-text search (two or more characters) is showing hits. */
  readonly searching: boolean
  readonly hitsFor: (conversationId: string) => readonly InboxSearchHit[]
  readonly onOpen: (conversationId: string, messageId?: string) => void
  readonly selection: {
    readonly selected: ReadonlySet<string>
    readonly visibleIds: readonly string[]
    readonly locked: boolean
    readonly onToggle: (id: string, checked: boolean) => void
    readonly onToggleAll: (checked: boolean) => void
  }
}

const CHIP_VARIANT: Readonly<Record<ConversationStatusChip, "default" | "secondary" | "outline">> = {
  Unread: "default",
  "Needs reply": "secondary",
  Saved: "outline",
  Archived: "outline",
  Closed: "outline",
}

function SourceTime({ display }: { readonly display: string }): React.ReactElement {
  return <span title="Source-local timestamp; timezone not proven">Source time: {display}</span>
}

/** The Messages sheet's columns (registry sheet "messages.job"). */
export function conversationColumns(options: InboxColumnOptions): ColumnDef<CorrespondenceSummary>[] {
  const { filter, searching, hitsFor, onOpen, selection } = options
  const selectedCount = selection.visibleIds.filter((id) => selection.selected.has(id)).length
  const allSelected = selection.visibleIds.length > 0 && selectedCount === selection.visibleIds.length
  return [
    {
      id: "select",
      enableSorting: false,
      size: 40,
      header: () => (
        <Checkbox
          checked={allSelected ? true : selectedCount ? "indeterminate" : false}
          disabled={selection.locked || selection.visibleIds.length === 0}
          onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
          aria-label="Select all visible conversations"
        />
      ),
      cell: ({ row: { original } }) => (
        <Checkbox
          checked={selection.selected.has(original.id)}
          disabled={selection.locked}
          onCheckedChange={(checked) => selection.onToggle(original.id, checked === true)}
          aria-label={`Select conversation: ${original.subject}`}
        />
      ),
    },
    {
      id: "subject",
      accessorFn: (row) => row.subject.toLocaleLowerCase(),
      header: "Subject",
      size: 320,
      cell: ({ row: { original } }) => {
        const hits = searching ? hitsFor(original.id) : []
        return (
          <div className="min-w-56 max-w-md">
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-2 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(original.id, hits[0]?.messageId)}
            >
              {original.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
              <span className={cn("truncate", original.unread ? "font-bold text-foreground" : "font-medium")}>
                {original.subject}
              </span>
              {original.origin?.source && <SourceTag className="shrink-0" source={original.origin.source} />}
            </button>
            {!searching && (
              <p className={cn("mt-0.5 truncate text-xs", original.unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {conversationExcerpt(original, filter)}
              </p>
            )}
            {hits.map((hit) => (
              <button
                key={hit.messageId}
                type="button"
                className="mt-1.5 block w-full text-left text-xs text-muted-foreground hover:underline"
                onClick={() => onOpen(original.id, hit.messageId)}
              >
                <span className="line-clamp-2">{hit.excerpt}</span>
                <span className="mt-0.5 block">
                  {hit.sourceSentDisplay && hit.sourceSentAt === null ? (
                    <SourceTime display={hit.sourceSentDisplay} />
                  ) : (
                    formatDateTime(hit.sentAt, hit.sentAt)
                  )}
                </span>
              </button>
            ))}
          </div>
        )
      },
    },
    {
      id: "with",
      accessorFn: (row) => conversationWith(row).toLocaleLowerCase() || undefined,
      header: "With",
      size: 200,
      cell: ({ row: { original } }) => (
        <span className="line-clamp-2 min-w-32 break-words text-sm">{conversationWith(original)}</span>
      ),
    },
    {
      id: "type",
      accessorFn: (row) => conversationType(row),
      header: "Type",
      size: 100,
      cell: ({ row: { original } }) => (
        <Badge variant={conversationType(original) === "email" ? "secondary" : "outline"}>
          {conversationTypeLabel(original)}
        </Badge>
      ),
    },
    {
      id: "lastActivity",
      accessorFn: (row) => conversationActivitySortValue(row, filter),
      header: filter === "sent" ? "Last sent" : "Last activity",
      sortDescFirst: true,
      size: 170,
      cell: ({ row: { original } }) => {
        const at = conversationActivityAt(original, filter)
        return (
          <span className="whitespace-nowrap text-sm tabular-nums">
            {original.lastActivityDisplay ? (
              <SourceTime display={original.lastActivityDisplay} />
            ) : (
              <time dateTime={at}>{formatDateTime(at, at)}</time>
            )}
          </span>
        )
      },
    },
    {
      id: "status",
      accessorFn: conversationStatusSortValue,
      header: "Status",
      sortDescFirst: true,
      size: 160,
      cell: ({ row: { original } }) => (
        <div className="flex flex-wrap gap-1">
          {conversationStatusChips(original).map((chip) => (
            <Badge key={chip} variant={CHIP_VARIANT[chip]}>
              {chip}
            </Badge>
          ))}
        </div>
      ),
    },
  ]
}
