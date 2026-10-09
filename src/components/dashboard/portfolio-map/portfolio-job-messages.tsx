"use client"

import type * as React from "react"
import { useRouter } from "next/navigation"
import { InboxRowItem, type NotificationRow } from "@/components/notifications/inbox-row"

export type PortfolioJobMessages = {
  readonly rows: readonly NotificationRow[]
  readonly loaded: boolean
  readonly onMarkRead: (row: NotificationRow) => void
  readonly onDone: (row: NotificationRow) => void
}

/**
 * The selected job's unread items on the map's Messages layer. The same rows
 * and actions as the job's section in the bell; Open goes where the bell goes.
 */
export function PortfolioJobMessageList({ messages }: { readonly messages: PortfolioJobMessages }): React.ReactElement {
  const router = useRouter()
  const unread = messages.rows.reduce((sum, row) => sum + row.unreadCount, 0)
  return (
    <section aria-label="Unread for this job" className="-mx-5 flex flex-col border-y border-border">
      <div className="flex items-baseline justify-between gap-2 px-5 pb-1 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unread for this job</span>
        {unread > 0 ? <span className="text-xs font-medium text-primary">{unread} new</span> : null}
      </div>
      {!messages.loaded ? (
        <p className="px-5 pb-3 text-sm text-muted-foreground">Loading…</p>
      ) : messages.rows.length === 0 ? (
        <p className="px-5 pb-3 text-sm text-muted-foreground">All clear on this job.</p>
      ) : (
        <ul className="pb-1">
          {messages.rows.map((row) => (
            <InboxRowItem
              key={row.key}
              row={row}
              onNavigate={(navigated, event) => {
                const isPlainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
                if (isPlainClick) {
                  event.preventDefault()
                  router.push(navigated.latest.href)
                }
                messages.onMarkRead(navigated)
              }}
              onMarkRead={messages.onMarkRead}
              onDone={messages.onDone}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
