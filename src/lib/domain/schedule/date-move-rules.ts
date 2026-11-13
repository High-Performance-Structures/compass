/**
 * The company's rule for schedule date moves (Settings › Workflows ›
 * Schedule confirmations), read once per request and handed to the store's
 * date moves (store.ts persistScheduleDateUpdates, runWithDateUpdates).
 */
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"

import type { DateMoveRules } from "./store"

export async function scheduleDateMoveRules(db: Db, organizationId: string): Promise<DateMoveRules> {
  const settings = await readFeatureSettings(db, organizationId, "schedule-confirmations")
  return { reaskOnDateMove: settings.reaskOnDateMove }
}
