import { getDb } from "@/db"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import type { TradeDocSettings } from "@/lib/trade-docs/settings"
import { isInternalStaffRole } from "@/lib/user-roles"

export type TradeDocAccess = {
  readonly user: AuthUser
  readonly organizationId: string
  readonly env: CloudflareEnv
  readonly db: ReturnType<typeof getDb>
  readonly settings: TradeDocSettings
  readonly canEdit: boolean
}

/** Office staff who can read vendors; `write` also needs vendor update rights. */
export async function tradeDocAccess(write: boolean): Promise<TradeDocAccess> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Trade docs are for office staff.")
  const canRead = await canFeature(user, "vendors", "read")
  if (!canRead) throw new Error("You don't have access to vendors.")
  const canEdit = !isDemoUser(user.id) && (await canFeature(user, "vendors", "update"))
  if (write && !canEdit) throw new Error("You don't have permission to change vendor records.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const settings = await readFeatureSettings(db, organizationId, "trade-docs")
  return { user, organizationId, env, db, settings, canEdit }
}
