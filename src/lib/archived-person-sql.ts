/**
 * SQL forms of the shared "Archived user – Name" formatter
 * (`src/lib/archived-person.ts`), for reads that build author and sender
 * names in the query. Server only.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm"

import { ARCHIVED_USER_PREFIX } from "@/lib/archived-person"
import { peopleView } from "@/lib/domain/identity/views"

/** True when the Compass account `userId` exists and is inactive. */
export function inactiveUserSql(userId: AnyColumn | SQL): SQL {
  return sql`exists (select 1 from ${peopleView()} archived_user where archived_user.id = ${userId} and archived_user.is_active = 0)`
}

/** `name`, or "Archived user – name" when `archived` holds. Empty names pass through. */
export function archivedAwareNameSql(name: AnyColumn | SQL, archived: SQL): SQL<string | null> {
  return sql<string | null>`case
    when (${archived}) and trim(coalesce(${name}, '')) <> '' then ${ARCHIVED_USER_PREFIX} || trim(${name})
    else ${name}
  end`
}
