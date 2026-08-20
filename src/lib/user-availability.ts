import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm"

import { users } from "@/db/schema"

const WORKOS_USER_ID_PREFIX = "user_"

/**
 * Active-user surfaces exclude invitation placeholders. Settings also includes
 * pending local invitations, while keeping deactivated WorkOS users hidden.
 */
export function getUserAvailabilityCondition(includeInvited: boolean): SQL {
  if (!includeInvited) return eq(users.isActive, true)

  const condition = or(
    eq(users.isActive, true),
    and(
      eq(users.isActive, false),
      isNull(users.lastLoginAt),
      sql`substr(${users.id}, 1, ${WORKOS_USER_ID_PREFIX.length}) <> ${WORKOS_USER_ID_PREFIX}`
    )
  )

  if (condition === undefined) {
    throw new Error("Failed to build the settings user availability condition")
  }
  return condition
}
