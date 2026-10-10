"use server"

import { and, eq, like } from "drizzle-orm"
import { getDb } from "@/db"
import { userViewPreferences } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { parseSavedOrder, ROLE_DASHBOARD_VIEW_PREFIX } from "@/lib/view-preferences/order"
import { isProjectWorkflowRoleId } from "@/lib/project-workflow-roles"

type SaveResult = { readonly success: true } | { readonly success: false; readonly error: string }

/** The signed-in user's saved Role Dashboard order for each role. */
export async function getRoleDashboardOrders(): Promise<Readonly<Record<string, readonly string[]>>> {
  const user = await getCurrentUser()
  if (!user) return {}
  const { env } = await getCloudflareContext()
  const rows = await getDb(env.DB)
    .select({ viewKey: userViewPreferences.viewKey, value: userViewPreferences.value })
    .from(userViewPreferences)
    .where(and(eq(userViewPreferences.userId, user.id), like(userViewPreferences.viewKey, `${ROLE_DASHBOARD_VIEW_PREFIX}%`)))
  return Object.fromEntries(rows.map((row) => [row.viewKey.slice(ROLE_DASHBOARD_VIEW_PREFIX.length), parseSavedOrder(row.value)]))
}

/** Saves (or, with an empty list, resets) the user's order for one role's dashboard. */
export async function saveRoleDashboardOrder(roleId: string, orderedIds: readonly string[]): Promise<SaveResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Sign in to save your layout." }
    if (isDemoUser(user.id)) return { success: false, error: "Demo accounts are read-only." }
    if (!isProjectWorkflowRoleId(roleId)) return { success: false, error: "Unknown role." }
    const order = parseSavedOrder(JSON.stringify(orderedIds))
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const viewKey = `${ROLE_DASHBOARD_VIEW_PREFIX}${roleId}`
    if (order.length === 0) {
      await db.delete(userViewPreferences).where(and(eq(userViewPreferences.userId, user.id), eq(userViewPreferences.viewKey, viewKey)))
      return { success: true }
    }
    const now = new Date().toISOString()
    await db
      .insert(userViewPreferences)
      .values({ userId: user.id, viewKey, value: JSON.stringify(order), updatedAt: now })
      .onConflictDoUpdate({
        target: [userViewPreferences.userId, userViewPreferences.viewKey],
        set: { value: JSON.stringify(order), updatedAt: now },
      })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save your layout." }
  }
}
