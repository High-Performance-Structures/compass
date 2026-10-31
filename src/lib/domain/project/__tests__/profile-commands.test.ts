import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  changeProjectJobStatus: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/domain/project/job-status", () => ({
  changeProjectJobStatus: mocks.changeProjectJobStatus,
}))

import { plainResult, updateProjectJobStatusCommand } from "@/lib/domain/project/profile-commands"

beforeEach(() => {
  mocks.changeProjectJobStatus.mockReset()
  mocks.revalidatePath.mockReset()
})

describe("updateProjectJobStatusCommand", () => {
  it("refreshes the project pages only when the status changed", async () => {
    mocks.changeProjectJobStatus.mockResolvedValueOnce({ success: true, changed: true })
    expect(await updateProjectJobStatusCommand({ projectId: "p-1", jobStatusId: "closed" })).toEqual({ success: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/projects/p-1")

    mocks.revalidatePath.mockReset()
    mocks.changeProjectJobStatus.mockResolvedValueOnce({ success: true, changed: false })
    expect(await updateProjectJobStatusCommand({ projectId: "p-1", jobStatusId: "closed" })).toEqual({ success: true })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("passes access errors through and hides unexpected failures", async () => {
    mocks.changeProjectJobStatus.mockResolvedValueOnce({ success: false, error: "Project not found" })
    expect(await updateProjectJobStatusCommand({ projectId: "p-1", jobStatusId: "x" })).toEqual({
      success: false,
      error: "Project not found",
    })

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.changeProjectJobStatus.mockRejectedValueOnce(new Error("D1 down"))
    expect(await updateProjectJobStatusCommand({ projectId: "p-1", jobStatusId: "x" })).toEqual({
      success: false,
      error: "Unable to update project status.",
    })
    consoleError.mockRestore()
  })
})

describe("plainResult", () => {
  it("drops the internal changed flag", () => {
    expect(plainResult({ success: true })).toEqual({ success: true })
    expect(plainResult({ success: false, error: "No" })).toEqual({ success: false, error: "No" })
  })
})
