import type * as React from "react"
import {
  recordSourceDescription,
  recordSourceTag,
  type RecordSource,
} from "@/lib/record-source"
import { cn } from "@/lib/utils"

/**
 * Imported-record source tag (owner-approved standard, see
 * docs/development/ui-standards.md): a small muted "[BT]" beside an imported
 * record. Never replace it with a sentence such as "Imported from ...".
 */
export function SourceTag({
  source,
  detail,
  className,
}: {
  readonly source: RecordSource
  /** Optional staff facts appended to the tooltip only, never shown inline. */
  readonly detail?: string
  readonly className?: string
}): React.ReactElement {
  const label = recordSourceDescription(source)
  return (
    <span
      className={cn("text-xs font-normal text-muted-foreground", className)}
      title={detail ? `${label}. ${detail}` : label}
      aria-label={label}
    >
      {recordSourceTag(source)}
    </span>
  )
}
