"use client"

import { usePathname, useSearchParams } from "next/navigation"

import { useProjectMessagesUnread } from "@/hooks/use-project-messages-unread"

/** Unread emails and conversations on the job, beside Messages in an owner's or vendor's menu. */
export function ProjectMessagesUnreadBadge({ projectId }: { readonly projectId: string }) {
  // Both are null outside the app router (tests, previews rendered alone).
  const pathname = usePathname() ?? ""
  const search = useSearchParams()?.toString() ?? ""
  const count = useProjectMessagesUnread(projectId, search ? `${pathname}?${search}` : pathname)
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
