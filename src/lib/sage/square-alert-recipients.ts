import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { ADMIN_USER_ROLES } from "@/lib/domain/identity/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import { seesStaffViews } from "@/lib/user-roles"

const memberships = membershipsView()
const people = peopleView()

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
      .select({ userId: people.id, role: memberships.role })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(people.isActive, true),
          ids === null ? inArray(people.role, [...ADMIN_USER_ROLES]) : inArray(people.id, [...ids]),
        ),
      )
  const staffIds = (rows: readonly { userId: string; role: string }[]): readonly string[] =>
    rows.filter((row) => seesStaffViews(row.role)).map((row) => row.userId)
  if (chosen.length > 0) return staffIds(await activeMembers(chosen))
  if (kind === "connection") {
    const developer = getJarvisEnvValue(env, "SQUARE_AUTH_NOTIFICATION_USER_ID")
    return developer ? staffIds(await activeMembers([developer])) : []
  }
  return staffIds(await activeMembers(null))
}
