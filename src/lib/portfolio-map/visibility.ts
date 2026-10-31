import { PORTFOLIO_MAP_VISIBILITIES, type PortfolioMapVisibility } from "@/lib/domain/project/statuses"
import { isListValue } from "@/lib/shared/statuses"

/** Per-project portfolio map override; "default" follows status and department. */
export type { PortfolioMapVisibility }

export function isPortfolioMapVisibility(value: string): value is PortfolioMapVisibility {
  return isListValue(PORTFOLIO_MAP_VISIBILITIES, value)
}
