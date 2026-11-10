/**
 * A one-line section on the pay request page that opens to its full content.
 * Native <details>, so it works without client JS and keeps the person's own
 * open/closed choice across refreshes of the same render.
 */
import { IconChevronRight } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

export function PayRequestFold({
  id,
  title,
  summary,
  badge,
  defaultOpen = false,
  className,
  children,
}: {
  /** Id of the heading, for aria-labelledby. */
  readonly id: string
  readonly title: string
  /** Short status shown beside the title, so the closed line still says something useful. */
  readonly summary?: React.ReactNode
  readonly badge?: React.ReactNode
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <details open={defaultOpen} aria-labelledby={id} className={cn("group clarity-panel print:hidden", className)}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <IconChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {badge}
        {summary ? <span className="min-w-0 text-sm text-muted-foreground">{summary}</span> : null}
      </summary>
      <div className="space-y-4 border-t px-4 py-3">{children}</div>
    </details>
  )
}
