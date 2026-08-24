import { describe, expect, it } from "vitest"
import { fieldCherishRecognitionSchema, fieldOutboxSchema } from "../types"

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

  it("preserves CHERISH feedback queued by the offline native shell", () => {
    const result = fieldOutboxSchema.safeParse([
      {
        id: "d8bfa307-c18e-4317-a3ba-4e581a318a10",
        kind: "cherish_pulse",
        cherishValue: "Integrity",
        responseType: "shoutout",
        message: "Thank you for taking ownership of the closeout list.",
        createdAt: "2026-08-18T02:30:00.000Z",
      },
    ])

    expect(result.success).toBe(true)
  })
})

describe("fieldCherishRecognitionSchema", () => {
  it("accepts public recognition and rejects private concerns", () => {
    const recognition = {
      id: "recognition-1",
      cherishValue: "Reliability",
      message: "Thank you for keeping the delivery moving.",
      submittedByName: "Martine",
      createdAt: "2026-08-24T12:00:00.000Z",
    }

    expect(
      fieldCherishRecognitionSchema.safeParse({
        ...recognition,
        responseType: "shoutout",
      }).success,
    ).toBe(true)
    expect(
      fieldCherishRecognitionSchema.safeParse({
        ...recognition,
        responseType: "concern",
      }).success,
    ).toBe(false)
  })
})
