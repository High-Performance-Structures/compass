import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationFeatureSettings } from "@/db/schema"
import { parseFeatureSettings, type FeatureSettingsKey, type FeatureSettingsValue } from "@/lib/feature-settings/registry"

/** A company's settings for one feature, with defaults filled in. */
export async function readFeatureSettings<K extends FeatureSettingsKey>(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  key: K,
): Promise<FeatureSettingsValue<K>> {
  const row = await db
    .select({ value: organizationFeatureSettings.value })
    .from(organizationFeatureSettings)
    .where(and(eq(organizationFeatureSettings.organizationId, organizationId), eq(organizationFeatureSettings.featureKey, key)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return parseFeatureSettings(key, row?.value)
}
