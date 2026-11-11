import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  submitFieldDailyLog: vi.fn(),
}))

vi.mock("@/app/actions/field-mode", () => ({
  submitFieldDailyLog: mocks.submitFieldDailyLog,
}))

import { POST } from "../route"

const validBody = {
  id: "9a714b2f-aead-4da0-8580-2545d5f5426e",
  projectId: "kiowa",
  payload: {
    logDate: "2026-08-18",
    workCompleted: "Framing progress",
    issues: "",
    crewPresent: "Dan",
    notes: "",
  },
}

describe("POST /api/field/daily-logs", () => {
  beforeEach(() => {
    mocks.submitFieldDailyLog.mockReset()
  })

  it("passes the client submission ID through for idempotent replay", async () => {
    mocks.submitFieldDailyLog.mockResolvedValue({
      success: true,
      dailyLogId: validBody.id,
    })

    const response = await POST(
      new Request("https://compass.example/api/field/daily-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      })
    )

    expect(response.status).toBe(200)
    // Fields added with cost code lines default to blank for older builds.
    expect(mocks.submitFieldDailyLog).toHaveBeenCalledWith(
      "kiowa",
      { ...validBody.payload, materialsUsed: "", safetyIncidents: "", visitorLog: "" },
      validBody.id
    )
    await expect(response.json()).resolves.toEqual({
      success: true,
      dailyLogId: validBody.id,
    })
  })

  it("passes installed selections and completed to-dos through to the save", async () => {
    mocks.submitFieldDailyLog.mockResolvedValue({ success: true, dailyLogId: validBody.id })
    const followUps = {
      todoUpdates: [
        { todoId: "t1", worked: true, completed: true, blocked: null },
        // Queued by a build before Completed.
        { todoId: "t2", worked: true, blocked: null },
      ],
      newTodos: [],
      clientContacts: [],
      installedSelectionIds: ["s1", "s2"],
    }
    const response = await POST(
      new Request("https://compass.example/api/field/daily-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, payload: { ...validBody.payload, followUps } }),
      })
    )
    expect(response.status).toBe(200)
    const sent = mocks.submitFieldDailyLog.mock.calls[0]?.[1]
    expect(sent?.followUps).toEqual({
      ...followUps,
      todoUpdates: [
        { todoId: "t1", worked: true, completed: true, blocked: null },
        { todoId: "t2", worked: true, completed: false, blocked: null },
      ],
    })
  })

  it("rejects an incomplete queued log", async () => {
    const response = await POST(
      new Request("https://compass.example/api/field/daily-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, payload: { workCompleted: "" } }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.submitFieldDailyLog).not.toHaveBeenCalled()
  })
})
