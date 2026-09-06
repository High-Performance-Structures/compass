import type * as React from "react"
import { HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT } from "@/lib/change-orders/provenance"

/** Legacy import requester fields are project-level defaults, not initiator evidence. */
export function ProjectChangeOrderProvenance(): React.ReactElement {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="block">Initiator: Not verified from Buildertrend</span>
      <span className="block">Purpose: Not classified</span>
      <span className="mt-1 block">{HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT}</span>
    </p>
  )
}
