"use client"

import * as React from "react"
import Link from "next/link"
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  BookmarkMinus,
  CheckCheck,
  Flag,
} from "lucide-react"
import { updateCorrespondenceInbox } from "@/app/actions/correspondence-inbox"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  CorrespondenceInbox,
  CorrespondenceInboxFilter,
  CorrespondenceSummary,
  ProjectDraft,
} from "@/lib/correspondence/types"
import { filterConversations } from "./correspondence-workspace-utils"
import { ProjectDraftList } from "./project-draft-list"
import { conversationColumns, type InboxSearchHit } from "./correspondence-inbox-columns"

const FILTERS: readonly { readonly value: CorrespondenceInboxFilter; readonly label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "unread", label: "Unread" },
  { value: "follow-up", label: "Needs reply" },
  { value: "saved", label: "Saved" },
  { value: "sent", label: "Sent" },
  { value: "drafts", label: "Drafts" },
  { value: "archived", label: "Archived" },
]

const rowId = (row: CorrespondenceSummary): string => row.id

type BulkAction = "read" | "archive" | "restore" | "follow-up" | "clear-follow-up" | "save" | "unsave"

/**
 * A project's Messages inbox: filter buttons, search (including message
 * text) and the conversations on the shared sortable sheet ("messages.job").
 */
export function CorrespondenceInboxPanel(props: {
  readonly drafts: readonly ProjectDraft[]
  readonly onOpenDraft: (draft: ProjectDraft) => Promise<void>
  readonly projectId: string
  readonly inbox: CorrespondenceInbox
  readonly activeId: string | null
  readonly filter: CorrespondenceInboxFilter
  readonly query: string
  readonly hits: readonly InboxSearchHit[]
  readonly hasMore: boolean
  readonly busy: boolean
  readonly onQuery: (query: string) => void
  readonly onFilter: (filter: CorrespondenceInboxFilter) => void
  readonly onNewMessage: () => Promise<void>
  readonly onNewEmail: () => Promise<void>
  readonly onOpen: (id: string, messageId?: string) => Promise<void>
  readonly onRefresh: () => Promise<CorrespondenceInbox | null>
  readonly className?: string
}): React.ReactElement {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const { filter, hits, inbox, onOpen, query } = props
  const searching = query.trim().length >= 2
  const visible = React.useMemo(() => {
    const matching = new Set(hits.map((hit) => hit.conversationId))
    return filterConversations(inbox.conversations, filter, searching ? "" : query)
      .filter((conversation) => !searching || matching.has(conversation.id))
  }, [filter, hits, inbox.conversations, query, searching])
  const visibleIds = React.useMemo(() => visible.map((conversation) => conversation.id), [visible])
  const selectedIds = visibleIds.filter((id) => selected.has(id))
  const locked = pending || props.busy
  const unreadCount = inbox.conversations.filter((c) => c.unread && !c.archived).length

  const hitsFor = React.useCallback(
    (conversationId: string) => hits.filter((hit) => hit.conversationId === conversationId),
    [hits],
  )
  const open = React.useCallback(
    (conversationId: string, messageId?: string) => { void onOpen(conversationId, messageId) },
    [onOpen],
  )
  const columns = React.useMemo(
    () => conversationColumns({
      filter,
      searching,
      hitsFor,
      onOpen: open,
      selection: {
        selected,
        visibleIds,
        locked,
        onToggle: (id, checked) => setSelected((current) => {
          const next = new Set(current)
          if (checked) next.add(id)
          else next.delete(id)
          return next
        }),
        onToggleAll: (checked) => setSelected(checked ? new Set(visibleIds) : new Set()),
      },
    }),
    [filter, searching, hitsFor, open, selected, visibleIds, locked],
  )
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}\u0000${query}`,
    initialItemId: props.activeId,
    sheetId: "messages.job",
  })

  async function update(action: BulkAction): Promise<void> {
    if (locked || selectedIds.length === 0) return
    setPending(true)
    setStatus(null)
    let completed = 0
    try {
      // Keep D1 batches bounded while allowing Select all to cover the entire visible inbox.
      // Completed chunks stay deselected after a later failure so retry targets only remaining work.
      for (let index = 0; index < selectedIds.length; index += 100) {
        const ids = selectedIds.slice(index, index + 100)
        const result = await updateCorrespondenceInbox(props.projectId, ids, action)
        if (!result.success) {
          setStatus(`${completed ? `${completed} conversations updated. ` : ""}${result.error}`)
          return
        }
        completed += ids.length
        setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))))
      }
      const outcome = {
        read: "marked as read",
        archive: "archived",
        restore: "restored",
        "follow-up": "flagged as needs reply",
        "clear-follow-up": "cleared from needs reply",
        save: "saved",
        unsave: "removed from Saved",
      }[action]
      setStatus(`${completed} ${completed === 1 ? "conversation" : "conversations"} ${outcome}.`)
    } catch {
      setStatus("The update could not be confirmed. Refresh and try again.")
    } finally {
      await props.onRefresh().catch(() => null)
      setPending(false)
    }
  }

  return (
    <aside className={cn("flex min-w-0 flex-col", props.className)} aria-label="Message inbox">
      <div className="space-y-3 border-b p-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Project messages</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h1 className="truncate text-lg font-semibold">{inbox.projectName}</h1>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" onClick={() => void props.onNewMessage()}>New message</Button>
              {inbox.workspace === "staff" && <Button size="sm" onClick={() => void props.onNewEmail()}>New email</Button>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Conversation filters">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              variant={filter === option.value ? "secondary" : "ghost"}
              size="sm"
              disabled={pending}
              onClick={() => {
                setSelected(new Set())
                setStatus(null)
                props.onFilter(option.value)
              }}
            >
              {option.label}
              {option.value === "drafts" && ` (${props.drafts.length})`}
              {option.value === "unread" && ` (${unreadCount})`}
            </Button>
          ))}
          {inbox.workspace === "staff" && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/projects/${encodeURIComponent(props.projectId)}/messages/global`}>Global</Link>
            </Button>
          )}
        </div>
        <RecordSearchInput
          value={query}
          onChange={(value) => {
            setSelected(new Set())
            props.onQuery(value)
          }}
          label="Search conversations"
          placeholder="Search subject, people or message text"
          className="sm:max-w-md"
        />
      </div>
      {filter === "drafts" ? (
        <ProjectDraftList drafts={props.drafts} query={query} busy={locked} onOpen={props.onOpenDraft} />
      ) : (
        <div className="space-y-3 p-4">
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
              <span className="mr-2">{selectedIds.length} selected</span>
              <Button size="sm" variant="outline" disabled={locked} onClick={() => void update("read")}>
                <CheckCheck />
                Mark as read
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => void update(filter === "follow-up" ? "clear-follow-up" : "follow-up")}
              >
                <Flag />
                {filter === "follow-up" ? "Clear needs reply" : "Needs reply"}
              </Button>
              <Button size="sm" variant="outline" disabled={locked} onClick={() => void update(filter === "saved" ? "unsave" : "save")}>
                {filter === "saved" ? <BookmarkMinus /> : <Bookmark />}
                {filter === "saved" ? "Remove from Saved" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => void update(filter === "archived" ? "restore" : "archive")}
              >
                {filter === "archived" ? <ArchiveRestore /> : <Archive />}
                {filter === "archived" ? "Restore" : "Archive"}
              </Button>
            </div>
          )}
          {status && <p className="text-xs" role="status">{status}</p>}
          <RecordTable
            table={table}
            itemLabel="conversations"
            emptyMessage={filter === "unread" ? "No unread conversations match this view." : "No conversations match this view."}
            rowIdPrefix="conversation-row"
            focusedRowId={props.activeId}
            scrollToFocusedRow={false}
            onRowOpen={(row) => open(row.id, searching ? hitsFor(row.id)[0]?.messageId : undefined)}
          />
          {searching && props.hasMore && (
            <p className="text-xs text-muted-foreground">
              Refine your search to narrow these results. Select all applies to the conversations shown.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
