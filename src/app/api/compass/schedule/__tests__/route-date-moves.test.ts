import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findTask: vi.fn(), loadProjectScheduleRows: vi.fn(), persist: vi.fn(), updateTask: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {}, AGENT_AUTH_SECRET: "s" } }) }))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/agent/api-auth", () => ({ validateAgentAuth: async () => ({ valid: true, role: "admin", orgId: "org-1", isDemoUser: false }) }))
vi.mock("@/lib/domain/schedule/access", () => ({ canViewWorkingSchedule: () => true }))
vi.mock("@/lib/domain/schedule/queries", () => ({
  findTask: mocks.findTask, isOrganizationProject: async () => true, loadProjectExceptions: async () => [],
  loadProjectScheduleRows: mocks.loadProjectScheduleRows, nextProjectSortOrder: vi.fn(),
}))
vi.mock("@/lib/domain/schedule/store", () => ({
  deleteDependency: vi.fn(), deleteTask: vi.fn(), insertDependency: vi.fn(), insertTask: vi.fn(),
  recalcCriticalPath: vi.fn(), setTaskAssignedTo: vi.fn(), updateTask: mocks.updateTask, persistScheduleDateUpdates: mocks.persist,
}))
vi.mock("@/lib/domain/schedule/date-move-rules", () => ({ scheduleDateMoveRules: async () => ({ reaskOnDateMove: true }) }))

import { POST } from "@/app/api/compass/schedule/route"

const task = {
  id: "task-1", projectId: "p1", title: "Framing", startDate: "2026-09-14", workdays: 3, endDateCalculated: "2026-09-16",
  status: "PENDING", percentComplete: 0, phase: "framing", isMilestone: false, isCriticalPath: false, sortOrder: 0,
}
const post = (body: object): Promise<Response> =>
  POST(new Request("https://compass.test/api/compass/schedule", { method: "POST", body: JSON.stringify({ action: "updateTask", taskId: "task-1", ...body }) }))

beforeEach(() => {
  mocks.findTask.mockResolvedValue(task)
  mocks.loadProjectScheduleRows.mockResolvedValue({ tasks: [task], dependencies: [] })
})
afterEach(() => vi.clearAllMocks())

describe("agent schedule API date moves", () => {
  it("doesn't move (or re-ask) an item whose dates didn't change", async () => {
    expect((await post({ title: "Framing walls" })).status).toBe(200)
    expect(mocks.persist).toHaveBeenCalledWith({}, "p1", new Map(), expect.any(String), { reaskOnDateMove: true }, "leave")
  })

  it("moves the item through the date moves when its dates change", async () => {
    expect((await post({ startDate: "2026-09-21" })).status).toBe(200)
    const moves = mocks.persist.mock.calls[0]?.[2]
    expect(moves).toEqual(new Map([["task-1", { startDate: "2026-09-21", endDateCalculated: expect.any(String), workdays: 3 }]]))
    expect(mocks.updateTask.mock.calls[0]?.[2]).not.toHaveProperty("startDate")
  })
})
