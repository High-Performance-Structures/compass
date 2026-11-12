import "server-only"

import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { VendorTypeSetting } from "@/lib/feature-settings/vendor-types-settings"
import type { Db } from "@/lib/server/action-context"

/** The company's vendor types (Settings › Company › Vendor types). */
export async function readVendorTypes(db: Db, organizationId: string): Promise<readonly VendorTypeSetting[]> {
  return (await readFeatureSettings(db, organizationId, "vendor-types")).types
}
