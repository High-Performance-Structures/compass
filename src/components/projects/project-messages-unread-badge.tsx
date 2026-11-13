"use client"

import { usePathname } from "next/navigation"

import { useAlertCount } from "@/hooks/use-alert-count"

/** Unread emails and conversations on the job, beside Messages in an owner's or vendor's menu. */
export function ProjectMessagesUnreadBadge({ projectId }: { readonly projectId: string }) {
  const pathname = usePathname()
  const count = useAlertCount(`/api/projects/${encodeURIComponent(projectId)}/messages/unread-count`, true, pathname)
  if (count === 0) return null
  return (
    <span
      className="ml-auto rounded-sm bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground tabular-nums"
      aria-label={`${count} unread`}
    >
      {count > 9 ? "9+" : count}
    </span>
  )
}
