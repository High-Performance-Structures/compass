import * as React from "react"
import { IconCircleCheck, IconClock } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * A record's Sage number, the way a project's Overview shows its Sage job
 * ("Sage job #123"). Shows "Sage: requested" while an add request is open,
 * and nothing when the record isn't in Sage.
 */
export function SageNumberBadge({
  number,
  label = "Sage",
  requested = false,
  className,
}: {
  readonly number: string | null | undefined
  /** "Sage job" for projects; "Sage" for vendors, clients and their people. */
  readonly label?: string
  readonly requested?: boolean
  readonly className?: string
}): React.ReactElement | null {
  const value = number?.trim()
  if (value) {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)}>
        <IconCircleCheck className="size-3.5" />
        {label} #{value}
      </Badge>
    )
  }
  if (!requested) return null
  return (
    <Badge variant="outline" className={cn("gap-1 text-muted-foreground", className)}>
      <IconClock className="size-3.5" />
      {label}: requested
    </Badge>
  )
}
