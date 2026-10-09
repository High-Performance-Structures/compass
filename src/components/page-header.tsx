import type { JSX, ReactNode } from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

type PageHeaderBack = {
  readonly href: string
  readonly label: string
}

type PageHeaderProps = {
  readonly title: ReactNode
  /** Small context label above the title, such as the project or desk name. */
  readonly eyebrow?: ReactNode
  /** Leading mark: a size-5 text-primary icon, or a department logo. */
  readonly icon?: ReactNode
  readonly back?: PageHeaderBack
  /** Page actions, aligned right on wide screens and wrapped below on narrow ones. */
  readonly actions?: ReactNode
  /** Record facts under the title, such as dates, owner, or an access note. */
  readonly meta?: ReactNode
  readonly className?: string
}

/**
 * The one header row every dashboard page starts with: optional back link,
 * small context label, title with icon, and the page's actions on the right.
 * Pages carry no explanation line under the title.
 * See docs/development/ui-standards.md, "Page anatomy".
 */
export function PageHeader({
  title,
  eyebrow,
  icon,
  back,
  actions,
  meta,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="mb-1.5 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowLeft className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        {eyebrow ? <p className="mb-0.5 text-sm text-muted-foreground">{eyebrow}</p> : null}
        <div className="flex items-center gap-2">
          {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        {meta ? <div className="mt-2 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
