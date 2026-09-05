import type * as React from "react"

/** Legacy import requester fields are project-level defaults, not initiator evidence. */
export function ProjectChangeOrderProvenance(): React.ReactElement {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="block">Initiator: Not verified from Buildertrend</span>
      <span className="block">Purpose: Not classified</span>
    </p>
  )
}
