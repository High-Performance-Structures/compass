import { describe, expect, it } from "vitest"

import { toFieldCherishRecognitions } from "@/lib/field/cherish-recognition"

describe("toFieldCherishRecognitions", () => {
  it("keeps approved team recognition fields and excludes private concerns", () => {
    const result = toFieldCherishRecognitions([
      {
        id: "shoutout-1",
        cherishValue: "Camaraderie",
        responseType: "shoutout",
        message: "The framing crew helped another team finish safely.",
        submittedByName: "Martine",
        createdAt: "2026-08-24T12:00:00.000Z",
      },
      {
        id: "concern-1",
        cherishValue: "Integrity",
        responseType: "concern",
        message: "Leadership-only context.",
        submittedByName: "Team member",
        createdAt: "2026-08-24T13:00:00.000Z",
      },
    ])

    expect(result).toEqual([
      {
        id: "shoutout-1",
        cherishValue: "Camaraderie",
        responseType: "shoutout",
        message: "The framing crew helped another team finish safely.",
        submittedByName: "Martine",
        createdAt: "2026-08-24T12:00:00.000Z",
      },
    ])
  })
})
