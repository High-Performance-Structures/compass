import { describe, expect, it } from "vitest"

import {
  templateFinishSelectionStatement,
  templateSelectionRoomStatement,
} from "@/lib/domain/selections/store"

/** A D1 stand-in that records the prepared SQL and its bound values. */
function recordingD1(): { readonly d1: D1Database; readonly calls: { sql: string; values: unknown[] }[] } {
  const calls: { sql: string; values: unknown[] }[] = []
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ sql, values })
          return {}
        },
      }
    },
  }
  // @ts-expect-error Only prepare/bind are exercised here.
  return { d1, calls }
}

describe("selections store raw template statements", () => {
  it("keeps the template room insert idempotent and binds its values in order", () => {
    const { d1, calls } = recordingD1()
    templateSelectionRoomStatement(d1, { id: "r1", projectId: "p1", roomName: "Kitchen", now: "t" })
    expect(calls[0]?.sql).toContain("INSERT OR IGNORE INTO project_finish_selection_rooms")
    expect(calls[0]?.values).toEqual(["r1", "p1", "Kitchen", "t", "t"])
  })

  it("inserts template selections hidden from owners and unapproved", () => {
    const { d1, calls } = recordingD1()
    templateFinishSelectionStatement(d1, {
      id: "s1",
      projectId: "p1",
      sourceRecordId: "src",
      roomName: "Kitchen",
      category: "Plumbing",
      name: "Faucet",
      description: null,
      costCode: "2210",
      status: "needed",
      notes: null,
      choiceOptionsJson: '["A"]',
      parentSelectionId: null,
      parentChoiceValue: null,
      selectionLevel: 0,
      sortOrder: 3,
      now: "t",
    })
    expect(calls[0]?.sql).toContain("INSERT INTO project_finish_selections")
    expect(calls[0]?.sql).toContain("'compass_template', ?, ?, ?, ?, ?, ?, ?, 0, 0,")
    expect(calls[0]?.values).toEqual([
      "s1", "p1", "src", "Kitchen", "Plumbing", "Faucet", null, "2210", "needed", null, '["A"]', null, null, 0, 3, "t", "t",
    ])
  })
})
