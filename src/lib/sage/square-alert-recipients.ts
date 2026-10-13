import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"

type Db = ReturnType<typeof getDb>
const ADMIN_ROLES = ["admin", "secondary_admin"]

export type SquareAlertKind = "connection" | "payments"

/**
 * Who gets Square alerts, from Settings → Workflows → Square and Sage
 * payments. Nobody chosen falls back to the old behaviour: connection alerts
 * to the configured developer only (never all staff), payment problems to
 * administrators.
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
      .select({ userId: users.id })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(users.isActive, true),
          ids === null ? inArray(users.role, ADMIN_ROLES) : inArray(users.id, [...ids]),
        ),
      )
  if (chosen.length > 0) return (await activeMembers(chosen)).map((row) => row.userId)
  if (kind === "connection") {
    const developer = getJarvisEnvValue(env, "SQUARE_AUTH_NOTIFICATION_USER_ID")
    return developer ? (await activeMembers([developer])).map((row) => row.userId) : []
  }
  return (await activeMembers(null)).map((row) => row.userId)
}
