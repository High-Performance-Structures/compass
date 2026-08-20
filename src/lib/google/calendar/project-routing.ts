import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { googleProjectCalendars } from "@/db/schema"

type Database = ReturnType<typeof getDb>

export async function activeGoogleProjectCalendarSelectionId(
  db: Database,
  organizationId: string,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null
  const row = await db
    .select({ selectionId: googleProjectCalendars.selectionId })
    .from(googleProjectCalendars)
    .where(
      and(
        eq(googleProjectCalendars.organizationId, organizationId),
        eq(googleProjectCalendars.projectId, projectId),
        eq(googleProjectCalendars.status, "active"),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return row?.selectionId ?? null
}
