import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getOwnerProjectUpdateDocument: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` })
  }),
  notFound: vi.fn((): never => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" })
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock("@/app/actions/project-field", () => ({
  getOwnerProjectUpdateDocument: mocks.getOwnerProjectUpdateDocument,
}))
vi.mock("@/lib/department-profiles-server", () => ({ currentDepartmentProfiles: vi.fn() }))
vi.mock("@/lib/permission-redirect", () => ({ redirectIfFeaturePermissionDenied: vi.fn() }))
vi.mock("@/components/projects/owner-update-document", () => ({ OwnerUpdateDocument: vi.fn() }))

import OwnerUpdatePage from "../page"

const params = Promise.resolve({ id: "project-1", updateId: "update-1" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("owner update page", () => {
  it("sends a deleted draft back to the project's owner updates", async () => {
    mocks.getOwnerProjectUpdateDocument.mockRejectedValue(new Error("Owner update not found"))

    await expect(OwnerUpdatePage({ params })).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/projects/project-1/owner-updates")
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it("still shows not found for other failures", async () => {
    mocks.getOwnerProjectUpdateDocument.mockRejectedValue(new Error("Project not found"))

    await expect(OwnerUpdatePage({ params })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
