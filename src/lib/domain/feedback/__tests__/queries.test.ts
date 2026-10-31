import { describe, expect, it } from "vitest"

import { LEGACY_FEEDBACK_WINDOW, unimportedConfirmedPrompts, unimportedLegacyFeedback } from "@/lib/domain/feedback/queries"

import { sqliteDb } from "../../__tests__/sqlite-d1"

const SCHEMA = `
  CREATE TABLE feedback (
    id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, name TEXT, email TEXT,
    page_url TEXT, user_agent TEXT, viewport_width INTEGER, viewport_height INTEGER, ip_hash TEXT,
    github_issue_url TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE feedback_desk_items (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, source TEXT NOT NULL, source_id TEXT NOT NULL
  );
  CREATE TABLE jarvis_bridge_events (
    id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, direction TEXT NOT NULL, source TEXT NOT NULL,
    event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
  );
`

function feedbackRow(index: number): string {
  const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()
  return `INSERT INTO feedback (id, type, message, created_at) VALUES ('f${index}', 'bug', 'm${index}', '${createdAt}');`
}

describe("Feedback Desk maintenance reads", () => {
  it("recovers only unimported rows from the newest legacy window, newest first", async () => {
    const rows = Array.from({ length: LEGACY_FEEDBACK_WINDOW + 5 }, (_, index) => feedbackRow(index)).join("\n")
    const newest = LEGACY_FEEDBACK_WINDOW + 4
    const { db } = sqliteDb(
      SCHEMA +
        rows +
        // Imported for this organization: skipped. Imported elsewhere: still recovered.
        `INSERT INTO feedback_desk_items VALUES ('d1', 'org-1', 'feedback-widget', 'f${newest}');` +
        `INSERT INTO feedback_desk_items VALUES ('d2', 'org-2', 'feedback-widget', 'f${newest - 1}');` +
        `INSERT INTO feedback_desk_items VALUES ('d3', 'org-1', 'ask-jarvis', 'f${newest - 2}');`,
    )
    const result = await unimportedLegacyFeedback(db, "org-1")
    // The window stays the newest 500 rows; the oldest 5 are never considered.
    expect(result).toHaveLength(LEGACY_FEEDBACK_WINDOW - 1)
    expect(result[0]?.id).toBe(`f${newest - 1}`)
    expect(result.map((row) => row.id)).not.toContain(`f${newest}`)
    expect(result.map((row) => row.id)).not.toContain("f4")
    expect(result.map((row) => row.id)).toContain("f5")
  })

  it("rechecks only this organization's Ask Jarvis prompts that have no desk item", async () => {
    const { db } = sqliteDb(
      SCHEMA +
        `INSERT INTO jarvis_bridge_events VALUES ('p1', 'org-1', 'outbound', 'ask-jarvis', 'agent.prompt', '{}', '2026-10-01T00:00:00.000Z');` +
        `INSERT INTO jarvis_bridge_events VALUES ('p2', 'org-1', 'outbound', 'ask-jarvis', 'agent.prompt', '{}', '2026-10-02T00:00:00.000Z');` +
        `INSERT INTO jarvis_bridge_events VALUES ('p3', 'org-2', 'outbound', 'ask-jarvis', 'agent.prompt', '{}', '2026-10-03T00:00:00.000Z');` +
        `INSERT INTO jarvis_bridge_events VALUES ('p4', 'org-1', 'inbound', 'ask-jarvis', 'agent.prompt', '{}', '2026-10-04T00:00:00.000Z');` +
        `INSERT INTO feedback_desk_items VALUES ('d1', 'org-1', 'ask-jarvis', 'p1');`,
    )
    const result = await unimportedConfirmedPrompts(db, "org-1")
    expect(result).toEqual([{ id: "p2", payload: "{}", createdAt: "2026-10-02T00:00:00.000Z" }])
  })
})
