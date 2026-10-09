import Link from "next/link"
import type * as React from "react"
import { cn } from "@/lib/utils"

export type DashboardCount = {
  readonly label: string
  readonly value: number
  readonly href: string
  /** Shown in the destructive color when above zero. */
  readonly urgent: boolean
}

/** Large, tabular counts that link straight to the work behind them. */
export function DashboardCountsStrip({
  counts,
}: {
  readonly counts: readonly DashboardCount[]
}): React.ReactElement {
  return (
    <nav
      aria-label="Work that needs attention"
      className={cn(
        "grid grid-cols-2 border-y border-border",
        // Fill the row whatever the number of counts (owners have three).
        counts.length <= 1 ? "sm:grid-cols-1" : counts.length === 2 ? "sm:grid-cols-2" : counts.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4",
      )}
    >
      {counts.map((count, index) => {
        const alarming = count.urgent && count.value > 0
        return (
          <Link
            key={count.label}
            href={count.href}
            className={cn(
              "flex flex-col gap-1 px-4 py-4 transition-colors hover:bg-accent",
              index > 0 && "sm:border-l sm:border-border",
              index % 2 === 1 && "border-l border-border sm:border-l",
              index >= 2 && "border-t border-border sm:border-t-0",
            )}
          >
            <span
              className={cn(
                "font-mono text-xs uppercase tracking-[0.12em]",
                alarming ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {alarming ? "● " : ""}
              {count.label}
            </span>
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                alarming && "text-destructive",
              )}
            >
              {count.value.toLocaleString()}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
