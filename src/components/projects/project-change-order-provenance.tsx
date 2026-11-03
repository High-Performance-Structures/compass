import type * as React from "react"
import { SourceTag } from "@/components/shared/source-tag"
import { HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT } from "@/lib/change-orders/provenance"

/**
 * Imported change orders show only the owner-approved "[BT]" source tag
 * (docs/development/ui-standards.md). Legacy requester fields are
 * project-level defaults, not initiator evidence, so callers never show them
 * for imported records; the evidence caveats stay in the tooltip for staff.
 */
const IMPORTED_CHANGE_ORDER_DETAIL =
  `Initiator not verified; purpose not classified. ${HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT}`

export function ProjectChangeOrderProvenance(): React.ReactElement {
  return <SourceTag source="buildertrend" detail={IMPORTED_CHANGE_ORDER_DETAIL} />
}
