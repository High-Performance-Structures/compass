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
  Search,
} from "lucide-react"
import { updateCorrespondenceInbox } from "@/app/actions/correspondence-inbox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type {
  CorrespondenceInbox,
  CorrespondenceInboxFilter,
} from "@/lib/correspondence/types"
import { filterConversations } from "./correspondence-workspace-utils"
import { ConversationTags } from "./correspondence-workspace-parts"

type SearchHit = {
  readonly conversationId: string
  readonly messageId: string
  readonly subject: string
  readonly excerpt: string
  readonly sentAt: string
  readonly sourceSentDisplay?: string | null
  readonly sourceSentAt?: string | null
}
export function CorrespondenceInboxPanel(props: {
  readonly projectId: string
  readonly inbox: CorrespondenceInbox
  readonly activeId: string | null
  readonly hiddenOnMobile: boolean
  readonly filter: CorrespondenceInboxFilter
  readonly query: string
  readonly hits: readonly SearchHit[]
  readonly hasMore: boolean
  readonly busy: boolean
  readonly onQuery: (query: string) => void
  readonly onFilter: (filter: CorrespondenceInboxFilter) => void
  readonly onNewMessage: () => Promise<void>
  readonly onOpen: (id: string, messageId?: string) => Promise<void>
  readonly onRefresh: () => Promise<CorrespondenceInbox | null>
}): React.ReactElement {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const searching = props.query.trim().length >= 2
  const matching = new Set(props.hits.map((hit) => hit.conversationId))
  const visible = filterConversations(
    props.inbox.conversations,
    props.filter,
    searching ? "" : props.query,
  ).filter((conversation) => !searching || matching.has(conversation.id))
  const visibleIds = visible.map((conversation) => conversation.id)
  const selectedIds = visibleIds.filter((id) => selected.has(id))
  const allSelected =
    visibleIds.length > 0 && selectedIds.length === visibleIds.length
  const locked = pending || props.busy
  function toggle(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  async function update(
    action:
      | "read"
      | "archive"
      | "restore"
      | "follow-up"
      | "clear-follow-up"
      | "save"
      | "unsave",
  ): Promise<void> {
    if (locked || selectedIds.length === 0) return
    setPending(true)
    setStatus(null)
    let completed = 0
    try {
      // Keep D1 batches bounded while allowing Select all to cover the entire visible inbox.
      // Completed chunks stay deselected after a later failure so retry targets only remaining work.
      for (let index = 0; index < selectedIds.length; index += 100) {
        const ids = selectedIds.slice(index, index + 100)
        const result = await updateCorrespondenceInbox(
          props.projectId,
          ids,
          action,
        )
        if (!result.success) {
          setStatus(
            `${completed ? `${completed} conversations updated. ` : ""}${result.error}`,
          )
          return
        }
        completed += ids.length
        setSelected(
          (current) => new Set([...current].filter((id) => !ids.includes(id))),
        )
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
      setStatus(
        `${completed} ${completed === 1 ? "conversation" : "conversations"} ${outcome}.`,
      )
    } catch {
      setStatus("The update could not be confirmed. Refresh and try again.")
    } finally {
      await props.onRefresh().catch(() => null)
      setPending(false)
    }
  }
  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col border-r md:w-92",
        props.hiddenOnMobile && "hidden md:flex",
      )}
      aria-label="Message inbox"
    >
      <div className="border-b p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Project messages
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="truncate text-lg font-semibold">
            {props.inbox.projectName}
          </h1>
          <Button size="sm" onClick={() => void props.onNewMessage()}>
            New message
          </Button>
        </div>
        <label className="relative mt-4 block">
          <Search
            className="absolute top-2.5 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            type="search"
            value={props.query}
            onChange={(event) => {
              setSelected(new Set())
              props.onQuery(event.target.value)
            }}
            placeholder="Search subjects and messages"
            aria-label="Search conversations"
          />
        </label>
        <div
          className="mt-3 flex flex-wrap gap-1"
          role="group"
          aria-label="Conversation filters"
        >
          {(["inbox", "unread", "follow-up", "saved", "archived"] as const).map(
            (filter) => (
              <Button
                key={filter}
                type="button"
                aria-pressed={props.filter === filter}
                variant={props.filter === filter ? "secondary" : "ghost"}
                size="sm"
                disabled={pending}
                onClick={() => {
                  setSelected(new Set())
                  setStatus(null)
                  props.onFilter(filter)
                }}
              >
                {filter === "follow-up"
                  ? "Needs reply"
                  : filter[0].toUpperCase() + filter.slice(1)}
                {filter === "unread" &&
                  ` (${props.inbox.conversations.filter((c) => c.unread && !c.archived).length})`}
              </Button>
            ),
          )}
          {props.inbox.workspace === "staff" && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/projects/${encodeURIComponent(props.projectId)}/messages/global`}>Global</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="border-b px-4 py-2">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={
              allSelected ? true : selectedIds.length ? "indeterminate" : false
            }
            disabled={locked || visible.length === 0}
            onCheckedChange={(checked) =>
              setSelected(checked === true ? new Set(visibleIds) : new Set())
            }
            aria-label="Select all visible conversations"
          />
          {selectedIds.length ? `${selectedIds.length} selected` : "Select all"}
          <span className="ml-auto text-muted-foreground">
            {visible.length}{" "}
            {visible.length === 1 ? "conversation" : "conversations"}
          </span>
        </label>
        {selectedIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => void update("read")}
            >
              <CheckCheck />
              Mark as read
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() =>
                void update(
                  props.filter === "follow-up"
                    ? "clear-follow-up"
                    : "follow-up",
                )
              }
            >
              <Flag />
              {props.filter === "follow-up"
                ? "Clear needs reply"
                : "Needs reply"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() =>
                void update(props.filter === "saved" ? "unsave" : "save")
              }
            >
              {props.filter === "saved" ? <BookmarkMinus /> : <Bookmark />}
              {props.filter === "saved" ? "Remove from Saved" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() =>
                void update(props.filter === "archived" ? "restore" : "archive")
              }
            >
              {props.filter === "archived" ? <ArchiveRestore /> : <Archive />}
              {props.filter === "archived" ? "Restore" : "Archive"}
            </Button>
          </div>
        )}
        {status && (
          <p className="mt-2 text-xs" role="status">
            {status}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            {props.filter === "unread"
              ? "No unread conversations match this view."
              : "No conversations match this view."}
          </p>
        ) : (
          visible.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "flex items-start gap-2 border-b px-4 py-3",
                conversation.id === props.activeId && "bg-accent",
              )}
            >
              <Checkbox
                className="mt-1 shrink-0"
                checked={selected.has(conversation.id)}
                disabled={locked}
                onCheckedChange={(checked) =>
                  toggle(conversation.id, checked === true)
                }
                aria-label={`Select conversation: ${conversation.subject}`}
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="w-full text-left hover:underline"
                  onClick={() =>
                    void props.onOpen(
                      conversation.id,
                      searching
                        ? props.hits.find(
                            (hit) => hit.conversationId === conversation.id,
                          )?.messageId
                        : undefined,
                    )
                  }
                >
                  <div
                    className={cn(
                      "flex items-center justify-between gap-3 text-xs",
                      conversation.unread
                        ? "font-bold text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <span className="truncate">
                      {conversation.people
                        .map((person) => person.name)
                        .join(", ")}
                    </span>
                    <span
                      className="shrink-0"
                      title={
                        conversation.lastActivityDisplay
                          ? "Source-local timestamp; timezone not proven"
                          : undefined
                      }
                    >
                      {conversation.lastActivityDisplay
                        ? `Source time: ${conversation.lastActivityDisplay}`
                        : formatTime(conversation.lastActivityAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {conversation.unread && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                    <span
                      className={cn(
                        "truncate",
                        conversation.unread ? "font-bold" : "font-normal",
                      )}
                    >
                      {conversation.subject}
                    </span>
                  </div>
                  {!searching && (
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 text-sm",
                        conversation.unread
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {conversation.excerpt}
                    </p>
                  )}
                </button>
                {searching &&
                  props.hits
                    .filter((hit) => hit.conversationId === conversation.id)
                    .map((hit) => (
                      <button
                        key={hit.messageId}
                        type="button"
                        className="mt-2 block w-full text-left text-sm text-muted-foreground hover:underline"
                        onClick={() =>
                          void props.onOpen(conversation.id, hit.messageId)
                        }
                      >
                        {hit.excerpt}
                        <span
                          className="mt-1 block text-xs"
                          title={
                            hit.sourceSentDisplay && hit.sourceSentAt === null
                              ? "Source-local timestamp; timezone not proven"
                              : undefined
                          }
                        >
                          {hit.sourceSentDisplay && hit.sourceSentAt === null
                            ? `Source time: ${hit.sourceSentDisplay}`
                            : formatTime(hit.sentAt)}
                        </span>
                      </button>
                    ))}
                <ConversationTags conversation={conversation} />
              </div>
            </div>
          ))
        )}
        {searching && props.hasMore && (
          <p className="p-4 text-xs text-muted-foreground">
            Refine your search to narrow these results. Select all applies to
            the conversations shown.
          </p>
        )}
      </div>
    </aside>
  )
}
function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString([], { month: "short", day: "numeric" })
}
