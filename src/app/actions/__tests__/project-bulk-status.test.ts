import { describe, expect, it, vi } from "vitest"

const update = vi.hoisted(() => vi.fn())
vi.mock("@/app/actions/project-profile", () => ({ updateProjectJobStatus: update }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateProjectJobStatuses } from "../project-bulk-status"

describe("updateProjectJobStatuses", () => {
  it("updates each project once and reports the ones it couldn't change", async () => {
    update.mockImplementation(async ({ projectId }: { projectId: string }) =>
      projectId === "p-locked" ? { success: false, error: "Permission denied." } : { success: true })
    const result = await updateProjectJobStatuses(["p-1", "p-2", "p-1", "p-locked"], "permitting")
    expect(update).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ success: true, updated: 2, failed: [{ projectId: "p-locked", error: "Permission denied." }] })
  })

  it("rejects an empty or oversized selection", async () => {
    expect((await updateProjectJobStatuses([], "permitting")).success).toBe(false)
    expect((await updateProjectJobStatuses(Array.from({ length: 101 }, (_, i) => `p-${i}`), "permitting")).success).toBe(false)
  })
})
