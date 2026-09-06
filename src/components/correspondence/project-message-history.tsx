"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Search } from "lucide-react"
import {
  getProjectMessageHistory,
  getProjectMessageHistoryDetail,
} from "@/app/actions/project-message-history"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type {
  CorrespondenceDetail,
  ProjectMessageHistoryPage,
} from "@/lib/correspondence/types"
import { MessageCard } from "./correspondence-message-card"

export function ProjectMessageHistory({
  projectId,
  initialPage,
}: {
  readonly projectId: string
  readonly initialPage: ProjectMessageHistoryPage
}): React.ReactElement {
  const [page, setPage] = React.useState(initialPage)
  const [query, setQuery] = React.useState("")
  const [appliedQuery, setAppliedQuery] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<CorrespondenceDetail | null>(null)
  const [detailPending, setDetailPending] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const requestVersion = React.useRef(0)

  async function loadList(more: boolean): Promise<void> {
    if (pending || (more && page.nextCursor === null)) return
    setPending(true)
    setStatus(null)
    try {
      const search = more ? appliedQuery : query
      const result = await getProjectMessageHistory(
        projectId,
        search,
        more ? (page.nextCursor ?? undefined) : undefined,
      )
      if (!result.success) {
        setStatus(result.error)
        return
      }
      setAppliedQuery(search)
      setPage((current) => ({
        ...result.data,
        conversations: more
          ? [
              ...current.conversations,
              ...result.data.conversations.filter(
                (row) =>
                  !current.conversations.some(
                    (existing) => existing.id === row.id,
                  ),
              ),
            ]
          : result.data.conversations,
      }))
    } catch {
      setStatus("History could not be loaded. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function openConversation(id: string, earlier = false): Promise<void> {
    const version = ++requestVersion.current
    const existing = earlier && detail?.conversation.id === id ? detail : null
    setSelectedId(id)
    if (!earlier) setDetail(null)
    setDetailPending(true)
    setDetailError(null)
    try {
      const result = await getProjectMessageHistoryDetail(
        projectId,
        id,
        existing?.messages[0]?.sequence,
      )
      if (version !== requestVersion.current) return
      if (!result.success) {
        setDetailError(result.error)
        return
      }
      setDetail({
        ...result.data,
        messages: existing
          ? [
              ...result.data.messages,
              ...existing.messages.filter(
                (message) =>
                  !result.data.messages.some(
                    (older) => older.id === message.id,
                  ),
              ),
            ]
          : result.data.messages,
      })
    } catch {
      if (version === requestVersion.current)
        setDetailError("Conversation could not be loaded. Try again.")
    } finally {
      if (version === requestVersion.current) setDetailPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">Global project messages</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sent project correspondence for the internal project team, including
          former employees’ conversations. Personal drafts stay private.
        </p>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Global message history"
          className={cn(
            "w-full shrink-0 overflow-y-auto border-r md:w-92",
            selectedId && "hidden md:block",
          )}
        >
          <div className="border-b p-4">
            <h1 className="truncate text-lg font-semibold">
              {page.projectName}
            </h1>
            <nav
              aria-label="Message views"
              className="mt-3 flex flex-wrap gap-1"
            >
              <Button asChild size="sm" variant="ghost">
                <Link
                  href={`/dashboard/projects/${encodeURIComponent(projectId)}/messages`}
                >
                  My inbox
                </Link>
              </Button>
              <Button size="sm" variant="secondary" aria-current="page">
                Global
              </Button>
            </nav>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void loadList(false)
              }}
            >
              <Input
                type="search"
                maxLength={500}
                aria-label="Search global messages"
                placeholder="Search subjects, messages, senders"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                size="icon"
                disabled={pending}
                aria-label="Search global history"
              >
                <Search />
              </Button>
            </form>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              className="mt-2"
              onClick={() => void loadList(false)}
            >
              Refresh history
            </Button>
            {status && (
              <p role="alert" className="mt-2 text-sm">
                {status}
              </p>
            )}
          </div>
          {page.conversations.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">
              No sent conversations match this view.
            </p>
          )}
          {page.conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => void openConversation(conversation.id)}
              aria-pressed={selectedId === conversation.id}
              className={cn(
                "block w-full border-b p-4 text-left hover:bg-accent",
                selectedId === conversation.id && "bg-accent",
              )}
            >
              <p className="truncate text-xs text-muted-foreground">
                {conversation.authorName}
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {conversation.subject}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {conversation.excerpt}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {conversation.sourceSentDisplay &&
                conversation.sourceSentAt === null
                  ? `Source time: ${conversation.sourceSentDisplay}`
                  : new Date(conversation.sentAt).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
              </p>
            </button>
          ))}
          {page.nextCursor && (
            <Button
              variant="outline"
              disabled={pending}
              className="m-4"
              onClick={() => void loadList(true)}
            >
              {pending ? "Loading…" : "Load more conversations"}
            </Button>
          )}
        </aside>
        <section
          aria-label="Project conversation history"
          className={cn(
            "min-w-0 flex-1 overflow-y-auto",
            !selectedId && "hidden md:block",
          )}
        >
          {selectedId ? (
            <div className="mx-auto max-w-4xl p-4 md:p-6">
              <Button
                variant="ghost"
                size="sm"
                className="mb-3 md:hidden"
                onClick={() => {
                  requestVersion.current++
                  setSelectedId(null)
                  setDetail(null)
                  setDetailPending(false)
                }}
              >
                <ArrowLeft />
                Back to history
              </Button>
              {detailError && (
                <p role="alert" className="mb-4 text-sm">
                  {detailError}
                </p>
              )}
              {detailPending && (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                  Loading conversation…
                </p>
              )}
              {detail && (
                <>
                  <h2 className="break-words text-xl font-semibold">
                    {detail.conversation.subject}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Project record · Viewing does not change personal read
                    status.
                  </p>
                  {detail.hasEarlier && (
                    <Button
                      variant="outline"
                      disabled={detailPending}
                      className="mt-4"
                      onClick={() =>
                        void openConversation(detail.conversation.id, true)
                      }
                    >
                      Load earlier messages
                    </Button>
                  )}
                  <div className="mt-5 grid gap-4">
                    {detail.messages.map((message) => (
                      <MessageCard
                        key={message.id}
                        projectId={projectId}
                        message={message}
                        viewerId={page.viewerId}
                        projectHistory
                        editDisabled
                        onEdit={async () => undefined}
                        onRetract={() => undefined}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-60 items-center justify-center p-6 text-sm text-muted-foreground">
              Select a conversation to review its project history.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
