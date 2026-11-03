import {
  agentConversations,
  agentMemories,
  notificationPreferences,
  pushTokens,
  slabMemories,
  userPermissionOverrides,
  userSchedulePreferences,
  userViewPreferences,
} from "@/db/schema"
import { typingSessions, userPresence } from "@/db/schema-conversations"
import {
  correspondenceDrafts,
  correspondenceState,
} from "@/db/schema-correspondence"
import { googleStarredFiles } from "@/db/schema-google"
import { mcpApiKeys, mcpUsage } from "@/db/schema-mcp"

/**
 * Rows that belong only to the person and serve no one else once the
 * account is gone. Children come before their parents so the deletes
 * succeed whether or not D1 enforces the cascade. The identity store
 * deletes them in runAccountDeletion.
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

/** WorkOS answers 404 when the identity is already gone; that counts as done. */
export function isWorkOSNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  )
}
