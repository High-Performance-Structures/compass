import { describe, expect, it } from "vitest"

import { unrecoveredNotificationEvents, unrecoveredNotificationEventsQuery } from "@/lib/domain/notifications/queries"

import { sqliteDb } from "../../__tests__/sqlite-d1"

// The notification_events columns and indexes from migrations 0041 and 0274.
const SCHEMA = `
  CREATE TABLE notification_events (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, project_id TEXT,
    event_type TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT,
    title TEXT NOT NULL, body TEXT NOT NULL, href TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal', audience TEXT NOT NULL DEFAULT 'internal',
    created_by TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notification_events_org_created ON notification_events (organization_id, created_at);
  CREATE INDEX idx_notification_events_project ON notification_events (project_id);
  CREATE INDEX notification_events_org_source_idx ON notification_events (organization_id, source_type, event_type, created_at);
`

const filter = {
  organizationId: "org-1",
  sourceType: "square_auth_health",
  eventType: "square_auth.failed",
  sourceIdPrefix: "square-invoice-auth:",
  createdBefore: "2026-10-30T12:00:00.000Z",
  limit: 50,
}

function event(id: string, values: Partial<Record<string, string>> = {}): string {
  const row = {
    organization_id: "org-1",
    event_type: "square_auth.failed",
    source_type: "square_auth_health",
    source_id: "square-invoice-auth:never:credentials_rejected",
    created_at: "2026-10-30T10:00:00.000Z",
    ...values,
  }
  return `INSERT INTO notification_events (id, organization_id, event_type, source_type, source_id, title, body, href, created_at)
    VALUES ('${id}', '${row.organization_id}', '${row.event_type}', '${row.source_type}', '${row.source_id}', 't', 'b', '/', '${row.created_at}');`
}

describe("unrecovered notification events (recovery sweep)", () => {
  it("searches the 0274 organization/source/event/created_at index and looks recoveries up by key", () => {
    const { sqlite, db } = sqliteDb(SCHEMA)
    const query = unrecoveredNotificationEventsQuery(db, filter).toSQL()
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params)
    const details = plan.map((step) => String(Reflect.get(Object(step), "detail")))
    expect(details[0]).toContain(
      "USING INDEX notification_events_org_source_idx (organization_id=? AND source_type=? AND event_type=? AND created_at<?)",
    )
    expect(details.some((detail) => detail.includes("recovery") && detail.includes("(id=?)"))).toBe(true)
    expect(details.some((detail) => detail.includes("SCAN"))).toBe(false)
  })

  it("returns only matching failures that have no recovery event yet", async () => {
    const { db } = sqliteDb(
      SCHEMA +
        event("open") +
        event("recovered") +
        event("recovered:recovered", { event_type: "square_auth.recovered" }) +
        event("other-service", { source_id: "square-compass-auth:never:unavailable" }) +
        event("other-org", { organization_id: "org-2" }) +
        event("after-success", { created_at: "2026-10-30T13:00:00.000Z" }),
    )
    const rows = await unrecoveredNotificationEvents(db, filter)
    expect(rows).toEqual([{ id: "open", sourceId: "square-invoice-auth:never:credentials_rejected" }])
  })
})
