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
        isAnonymous: true,
        submittedByName: "Martine",
        audience: { scope: "user" },
        createdAt: "2026-08-24T12:00:00.000Z",
      },
      {
        id: "concern-1",
        cherishValue: "Integrity",
        responseType: "concern",
        message: "Leadership-only context.",
        isAnonymous: false,
        submittedByName: "Team member",
        audience: { scope: "company" },
        createdAt: "2026-08-24T13:00:00.000Z",
      },
    ])

    expect(result).toEqual([
      {
        id: "shoutout-1",
        cherishValue: "Camaraderie",
        responseType: "shoutout",
        message: "The framing crew helped another team finish safely.",
        isAnonymous: true,
        submittedByName: null,
        audienceScope: "user",
        createdAt: "2026-08-24T12:00:00.000Z",
      },
    ])
  })
})
