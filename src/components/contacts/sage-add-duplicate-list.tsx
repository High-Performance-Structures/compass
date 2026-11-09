import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { SageNumberBadge } from "@/components/sage-number-badge"
import { DUPLICATE_REASON_LABELS, type DuplicateMatch } from "@/lib/sage/directory-add-duplicates"
import { SAGE_ADD_KIND_LABELS } from "@/lib/sage/directory-add-request"

/** Look-alikes Compass found for a "Request add to Sage", with why each one matched. */
export function SageAddDuplicateList({
  matches,
  action,
}: {
  readonly matches: readonly DuplicateMatch[]
  /** Optional button per match (e.g. link to it instead). */
  readonly action?: (match: DuplicateMatch) => React.ReactNode
}): React.ReactElement | null {
  if (matches.length === 0) return null
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {matches.map((match) => (
        <li key={`${match.source}:${match.kind}:${match.id}:${match.name}`} className="flex flex-wrap items-start justify-between gap-2 p-2">
          <div className="min-w-0 space-y-1">
            <div className="font-medium">{match.name}</div>
            <div className="text-xs text-muted-foreground">
              {[
                match.source === "sage" ? `In Sage (${SAGE_ADD_KIND_LABELS[match.kind].toLowerCase()})` : `In Compass (${SAGE_ADD_KIND_LABELS[match.kind].toLowerCase()})`,
                match.parentName ? `at ${match.parentName}` : null,
                match.email,
                match.phone,
              ].filter(Boolean).join(" · ")}
            </div>
            <div className="flex flex-wrap gap-1">
              {match.source === "compass" ? <SageNumberBadge number={match.sageNumber} /> : null}
              {match.reasons.map((reason) => <Badge key={reason} variant="outline">{DUPLICATE_REASON_LABELS[reason]}</Badge>)}
            </div>
          </div>
          {action ? action(match) : null}
        </li>
      ))}
    </ul>
  )
}
