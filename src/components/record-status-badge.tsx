import type * as React from "react"

import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { cn } from "@/lib/utils"

/** Theme colors for each status color token (light and dark come from the theme). */
const COLOR_CLASSES: Readonly<Record<RecordStatusColor, { readonly badge: string; readonly dot: string }>> = {
  gray: { badge: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  blue: { badge: "border-info/30 bg-info/10 text-info", dot: "bg-info" },
  green: { badge: "border-success/30 bg-success/10 text-success", dot: "bg-success" },
  orange: { badge: "border-warning/30 bg-warning/10 text-warning", dot: "bg-warning" },
  red: { badge: "border-destructive/30 bg-destructive/10 text-destructive", dot: "bg-destructive" },
}

/** The small colored dot for a status color (filter buttons, Settings). */
export function RecordStatusDot({ color, className }: { readonly color: RecordStatusColor; readonly className?: string }): React.ReactElement {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", COLOR_CLASSES[color].dot, className)} />
}

/**
 * A record's status as the company names and colors it (Settings ›
 * Statuses). Read the label and color with `recordStatusLabel` and
 * `recordStatusColor` from the record type's status list.
 */
export function RecordStatusBadge({
  label,
  color,
  className,
}: {
  readonly label: string
  readonly color: RecordStatusColor
  readonly className?: string
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        COLOR_CLASSES[color].badge,
        className,
      )}
    >
      {label}
    </span>
  )
}
