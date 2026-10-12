import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCherishPulseTeamStream: vi.fn(),
  submitCherishPulseResponse: vi.fn(),
  getActiveCherishStories: vi.fn(),
}))

vi.mock("@/app/actions/cherish-stories", () => ({
  getActiveCherishStories: mocks.getActiveCherishStories,
}))

vi.mock("@/app/actions/cherish-pulse", () => ({
  getCherishPulseTeamStream: mocks.getCherishPulseTeamStream,
  submitCherishPulseResponse: mocks.submitCherishPulseResponse,
}))

import { GET, POST } from "../route"

describe("GET /api/field/cherish", () => {
  beforeEach(() => {
    mocks.getCherishPulseTeamStream.mockReset()
    mocks.getActiveCherishStories.mockReset()
    mocks.getActiveCherishStories.mockResolvedValue({ success: true, data: [] })
  })

  it("returns only crew-safe approved recognition without caching", async () => {
    mocks.getCherishPulseTeamStream.mockResolvedValue({
      success: true,
      data: [
        {
          id: "win-1",
          cherishValue: "Excellence",
          responseType: "win",
          message: "The team passed inspection on the first visit.",
          source: "compass_dashboard",
          visibility: "team",
          reviewStatus: "approved",
          isAnonymous: true,
          submittedByName: "Martine",
          submittedByEmail: "martine@example.com",
          weekStart: "2026-08-24",
          createdAt: "2026-08-24T12:00:00.000Z",
          audience: { scope: "user", recipientId: "field-user-1" },
        },
        {
          id: "defense-in-depth",
          cherishValue: "Integrity",
          responseType: "concern",
          message: "Private concern",
          source: "compass_dashboard",
          visibility: "private",
          reviewStatus: "approved",
          isAnonymous: false,
          submittedByName: "Team member",
          submittedByEmail: "private@example.com",
          weekStart: "2026-08-24",
          createdAt: "2026-08-24T13:00:00.000Z",
          audience: { scope: "company" },
        },
      ],
    })

    const response = await GET()
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(body).toEqual({
      success: true,
      items: [
        {
          id: "win-1",
          cherishValue: "Excellence",
          responseType: "win",
          message: "The team passed inspection on the first visit.",
          isAnonymous: true,
          submittedByName: null,
          audienceScope: "user",
          createdAt: "2026-08-24T12:00:00.000Z",
          isNew: false,
        },
      ],
    })
  })

  it("flags stories this person has not viewed in the 24-hour window as new", async () => {
    const recognition = {
      cherishValue: "Excellence",
      responseType: "shoutout",
      message: "Thanks for staying late to finish the pour.",
      source: "compass_dashboard",
      visibility: "team",
      reviewStatus: "approved",
      isAnonymous: false,
      submittedByName: "Team member",
      submittedByEmail: "team@example.com",
      weekStart: "2026-10-05",
      audience: { scope: "company" },
    }
    mocks.getCherishPulseTeamStream.mockResolvedValue({
      success: true,
      data: [
        { ...recognition, id: "unseen", createdAt: "2026-10-11T12:00:00.000Z" },
        { ...recognition, id: "seen", createdAt: "2026-10-11T11:00:00.000Z" },
        { ...recognition, id: "older", createdAt: "2026-10-01T11:00:00.000Z" },
      ],
    })
    mocks.getActiveCherishStories.mockResolvedValue({
      success: true,
      data: [
        { id: "unseen", viewedAt: null },
        { id: "seen", viewedAt: "2026-10-11T12:30:00.000Z" },
      ],
    })

    const body = await (await GET()).json()

    expect(
      body.items.map((item: { id: string; isNew: boolean }) => [item.id, item.isNew]),
    ).toEqual([
      ["unseen", true],
      ["seen", false],
      ["older", false],
    ])
  })

  it("keeps unauthorized users out of the team stream", async () => {
    mocks.getCherishPulseTeamStream.mockResolvedValue({
      success: false,
      error: "Only internal team members can view CHERISH recognition.",
    })

    const response = await GET()

    expect(response.status).toBe(403)
  })
})

describe("POST /api/field/cherish", () => {
  beforeEach(() => {
    mocks.submitCherishPulseResponse.mockReset()
  })

  it("passes the anonymous choice through the authenticated Field API", async () => {
    mocks.submitCherishPulseResponse.mockResolvedValue({
      success: true,
      data: { id: "d8bfa307-c18e-4317-a3ba-4e581a318a10" },
    })

    const response = await POST(
      new Request("https://compass.example/api/field/cherish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "d8bfa307-c18e-4317-a3ba-4e581a318a10",
          cherishValue: "Honor",
          responseType: "shoutout",
          message: "Thank you for helping the team.",
          anonymous: true,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.submitCherishPulseResponse).toHaveBeenCalledWith(
      expect.objectContaining({ anonymous: true }),
    )
  })
})
