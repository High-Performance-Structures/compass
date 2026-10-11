import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  accountDeletionRequests,
  agentConversations,
  agentMemories,
  notificationPreferences,
  pushTokens,
  slabMemories,
  userPermissionOverrides,
  userSchedulePreferences,
  users,
  userViewPreferences,
} from "@/db/schema"
import { typingSessions, userPresence } from "@/db/schema-conversations"
import {
  correspondenceDrafts,
  correspondenceState,
} from "@/db/schema-correspondence"
import { googleStarredFiles } from "@/db/schema-google"
import { mcpApiKeys, mcpUsage } from "@/db/schema-mcp"

type Db = ReturnType<typeof getDb>

export const DELETED_USER_DISPLAY_NAME = "Deleted user"

/**
 * Rows that belong only to the person and serve no one else once the
 * account is gone. Children come before their parents so the deletes
 * succeed whether or not D1 enforces the cascade.
 */
export const PERSONAL_DATA_TABLES = [
  pushTokens,
  notificationPreferences,
  userSchedulePreferences,
  userViewPreferences,
  userPermissionOverrides,
  userPresence,
  typingSessions,
  correspondenceState,
  correspondenceDrafts,
  googleStarredFiles,
  mcpUsage,
  mcpApiKeys,
  agentMemories,
  agentConversations,
  slabMemories,
] as const

/**
 * The users row is kept because project, financial and audit records point
 * at it. Everything that identifies the person is cleared, and the email
 * becomes a unique placeholder so the address can sign up again later.
 */
export type DeidentifiedUserValues = {
  readonly email: string
  readonly firstName: null
  readonly lastName: null
  readonly displayName: string
  readonly phone: null
  readonly address: null
  readonly avatarUrl: null
  readonly dashboardDeskPhotoUrl: null
  readonly sidebarDeskPhotoUrl: null
  readonly googleEmail: null
  readonly isActive: false
  readonly updatedAt: string
}

export function deidentifiedUserValues(
  userId: string,
  now: string
): DeidentifiedUserValues {
  return {
    email: `deleted+${userId}@deleted.invalid`,
    firstName: null,
    lastName: null,
    displayName: DELETED_USER_DISPLAY_NAME,
    phone: null,
    address: null,
    avatarUrl: null,
    dashboardDeskPhotoUrl: null,
    sidebarDeskPhotoUrl: null,
    googleEmail: null,
    isActive: false,
    updatedAt: now,
  }
}

/**
 * Remove the person's data, de-identify their user row and close the
 * request in one batch, so a failure leaves nothing half-done.
 */
export async function runAccountDeletion(
  db: Db,
  input: {
    readonly requestId: string
    readonly userId: string
    readonly completedBy: string
    readonly now: string
  }
): Promise<void> {
  const { requestId, userId, completedBy, now } = input
  const deletes = PERSONAL_DATA_TABLES.map((table) =>
    db.delete(table).where(eq(table.userId, userId))
  )
  // drizzle's batch wants a non-empty tuple, so a fixed statement leads.
  await db.batch([
    db
      .update(users)
      .set(deidentifiedUserValues(userId, now))
      .where(eq(users.id, userId)),
    ...deletes,
    db
      .update(accountDeletionRequests)
      .set({
        status: "completed",
        completedAt: now,
        completedBy,
        emailSnapshot: null,
        displayNameSnapshot: null,
        updatedAt: now,
      })
      .where(eq(accountDeletionRequests.id, requestId)),
  ])
}

/** WorkOS answers 404 when the identity is already gone; that counts as done. */
export function isWorkOSNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  )
}
