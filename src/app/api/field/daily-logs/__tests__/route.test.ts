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
    expect(mocks.submitFieldDailyLog).toHaveBeenCalledWith(
      "kiowa",
      validBody.payload,
      validBody.id
    )
    await expect(response.json()).resolves.toEqual({
      success: true,
      dailyLogId: validBody.id,
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
