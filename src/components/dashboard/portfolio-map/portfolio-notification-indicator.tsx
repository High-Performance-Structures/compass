"use client"

import type * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bell } from "lucide-react"
import type { PortfolioJobMessages } from "./portfolio-job-messages"
import { openPortfolioNotification } from "./portfolio-job-messages"

/** One source opens directly; several sources open the job's source list. */
export function PortfolioNotificationIndicator({
  messages,
  jobName,
  onOpen,
}: {
  readonly messages: PortfolioJobMessages | null
  readonly jobName: string
  readonly onOpen: () => void
}): React.ReactElement | null {
  const router = useRouter()
  if (!messages?.loaded || messages.rows.length === 0) return null
  const unread = messages.rows.reduce((sum, row) => sum + row.unreadCount, 0)
  const label = `${unread} unread notification${unread === 1 ? "" : "s"} for ${jobName}`
  const content = (
    <>
      <Bell className="size-3.5" aria-hidden="true" />
      <span>{unread} new</span>
    </>
  )
  const className =
    "flex min-h-8 items-center gap-1.5 px-3 text-xs text-primary hover:bg-accent focus-visible:outline focus-visible:outline-ring"
  const only = messages.rows.length === 1 ? messages.rows[0] : undefined
  return only ? (
    <Link
      href={only.latest.href}
      aria-label={label}
      className={className}
      onClick={(event) => openPortfolioNotification(only, event, router.push, messages.onMarkRead)}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={`${label}; show sources`}
      className={className}
      onClick={onOpen}
    >
      {content}
    </button>
  )
}
