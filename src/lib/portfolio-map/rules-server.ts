import type { getDb } from "@/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { DEFAULT_PORTFOLIO_MAP_RULES, type PortfolioMapRules } from "@/lib/portfolio-map/phases"

/** The company's map rules; the built-in ones if settings can't be read. */
export async function readPortfolioMapRules(db: ReturnType<typeof getDb>, organizationId: string): Promise<PortfolioMapRules> {
  try {
    return await readFeatureSettings(db, organizationId, "portfolio-map")
  } catch (error) {
    console.error("Portfolio map settings unavailable", error instanceof Error ? error.message : error)
    return DEFAULT_PORTFOLIO_MAP_RULES
  }
}
