import { eq, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationFeatureSettings, organizations } from "@/db/schema"
import { parseFeatureSettings } from "@/lib/feature-settings/registry"
import { readPortfolioMapRules } from "@/lib/portfolio-map/rules-server"
import { weatherAreaForState, type WeatherArea } from "@/lib/weather/areas"

type Db = ReturnType<typeof getDb>

/** The weather area for a company: the state its map shows. */
export async function organizationWeatherArea(db: Db, organizationId: string): Promise<WeatherArea> {
  return weatherAreaForState((await readPortfolioMapRules(db, organizationId)).mapState)
}

/** Areas some company's map shows (client organizations use their contractor's map). */
export async function weatherAreasInUse(db: Db): Promise<readonly WeatherArea[]> {
  const [companies, rows] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations).where(ne(organizations.type, "client")),
    db
      .select({ organizationId: organizationFeatureSettings.organizationId, value: organizationFeatureSettings.value })
      .from(organizationFeatureSettings)
      .where(eq(organizationFeatureSettings.featureKey, "portfolio-map")),
  ])
  const stored = new Map(rows.map((row) => [row.organizationId, row.value]))
  const areas = new Map<string, WeatherArea>()
  for (const company of companies) {
    const area = weatherAreaForState(parseFeatureSettings("portfolio-map", stored.get(company.id)).mapState)
    areas.set(area.key, area)
  }
  return [...areas.values()]
}
