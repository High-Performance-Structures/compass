import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import { ADMIN_USER_ROLES } from "@/lib/domain/identity/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

export type SquareAlertKind = "connection" | "payments"

/**
 * Who gets Square alerts, from Settings → Workflows → Square and Sage
 * payments. Nobody chosen falls back to the old behaviour: connection alerts
 * to the configured developer only (never all staff), payment problems to
 * administrators. Only internal staff (and the developer) ever receive them;
 * subcontractors, suppliers, clients and guests are dropped.
 */
export async function squareAlertRecipientIds(
  db: Db,
  env: CloudflareEnv,
  organizationId: string,
  kind: SquareAlertKind,
): Promise<readonly string[]> {
  let chosen: readonly string[] = []
  try {
    const settings = await readFeatureSettings(db, organizationId, "square-payments")
    chosen = kind === "connection" ? settings.connectionAlertUserIds : settings.paymentAlertUserIds
  } catch {
    chosen = []
  }
  const activeMembers = (ids: readonly string[] | null) =>
    db
      .select({ userId: users.id, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(users.isActive, true),
          ids === null ? inArray(users.role, [...ADMIN_USER_ROLES]) : inArray(users.id, [...ids]),
        ),
      )
  const staffIds = (rows: readonly { userId: string; role: string }[]): readonly string[] =>
    rows.filter((row) => isInternalStaffRole(row.role) || row.role === "developer").map((row) => row.userId)
  if (chosen.length > 0) return staffIds(await activeMembers(chosen))
  if (kind === "connection") {
    const developer = getJarvisEnvValue(env, "SQUARE_AUTH_NOTIFICATION_USER_ID")
    return developer ? staffIds(await activeMembers([developer])) : []
  }
  return staffIds(await activeMembers(null))
}
