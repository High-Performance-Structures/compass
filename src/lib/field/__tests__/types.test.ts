import { describe, expect, it } from "vitest"
import { fieldOutboxSchema } from "../types"

describe("fieldOutboxSchema", () => {
  it("preserves daily log drafts queued by mobile builds before attachments", () => {
    const result = fieldOutboxSchema.safeParse([
      {
        id: "queued-log-1",
        kind: "daily_log",
        projectId: "proj-kiowa-yard",
        createdAt: "2026-07-19T18:00:00.000Z",
        payload: {
          logDate: "2026-07-19",
          workCompleted: "Prepared the yard for Monday deliveries.",
          issues: "",
          crewPresent: "Field crew",
          notes: "",
        },
      },
    ])

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data[0]).toMatchObject({
      remoteDailyLogId: null,
      attachments: [],
    })
  })
})
