import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { upsertGoogleCalendarSelections } from "@/lib/domain/calendars/store"

// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function sqlOf(statement: unknown): { readonly sql: string } {
  return (statement as { toSQL(): { readonly sql: string } }).toSQL()
}

describe("calendar store", () => {
  it("saves the whole calendar list in one batch and keeps existing choices on conflict", async () => {
    const batches: unknown[][] = []
    const fake = Object.assign(Object.create(db) as typeof db, {
      batch: async (statements: unknown[]) => {
        batches.push(statements)
        return []
      },
    })
    const calendar = {
      id: "cal-1",
      summary: "Jobs",
      description: null,
      timeZone: "America/Denver",
      backgroundColor: null,
      accessRole: "owner",
      primary: false,
    }
    await upsertGoogleCalendarSelections(fake, {
      connectionId: "c1",
      calendars: [calendar, { ...calendar, id: "cal-2" }],
      now: "t",
    })
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    const first = sqlOf(batches[0]?.[0])
    expect(first.sql).toContain(
      'on conflict ("google_calendar_selections"."connection_id", "google_calendar_selections"."google_calendar_id") do update set'
    )
    // A refresh never resets what the person chose to import or export.
    const updateClause = first.sql.slice(first.sql.indexOf("do update set"))
    expect(updateClause).not.toContain('"selected"')
    expect(updateClause).not.toContain('"import_events"')

    batches.length = 0
    await upsertGoogleCalendarSelections(fake, { connectionId: "c1", calendars: [], now: "t" })
    expect(batches).toHaveLength(0)
  })
})
