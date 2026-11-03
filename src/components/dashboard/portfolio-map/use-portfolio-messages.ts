"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useNotificationInbox } from "@/hooks/use-notification-inbox"
import { groupInbox } from "@/lib/notifications/inbox"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"
import type { PortfolioJobMessages } from "./portfolio-job-messages"

export type PortfolioMessagesForJob = (jobId: string) => PortfolioJobMessages | null

/** Share the bell's recipient-scoped source; never fetch an inbox per job. */
export function usePortfolioMessages(enabled: boolean): {
  readonly messagesForJob: PortfolioMessagesForJob
  readonly stacks: ReturnType<typeof messageStacksFrom>
  readonly openNotification: (notificationId: string) => void
} {
  const router = useRouter()
  const inbox = useNotificationInbox(enabled)
  const { markRead, done } = inbox
  const rowsByJob = React.useMemo(
    () =>
      new Map(
        groupInbox(
          inbox.items.filter((item) => item.readAt === null && item.projectId !== null),
        ).map((section) => [section.key, section.rows]),
      ),
    [inbox.items],
  )
  const stacks = React.useMemo(() => messageStacksFrom(inbox.items), [inbox.items])
  const messagesForJob = React.useCallback<PortfolioMessagesForJob>(
    (jobId) => {
      if (!enabled) return null
      return {
        rows: rowsByJob.get(jobId) ?? [],
        loaded: inbox.loaded,
        onMarkRead: (row) => void markRead(row),
        onDone: (row) => void done(row),
      }
    },
    [done, enabled, inbox.loaded, markRead, rowsByJob],
  )
  const openNotification = React.useCallback(
    (notificationId: string): void => {
      const item = inbox.items.find((item) => item.id === notificationId && item.readAt === null)
      if (!item || !enabled) return
      router.push(item.href)
      void markRead({ key: `item:${item.id}`, latest: item, items: [item], unreadCount: 1 })
    },
    [enabled, inbox.items, markRead, router],
  )
  return { messagesForJob, stacks, openNotification }
}
