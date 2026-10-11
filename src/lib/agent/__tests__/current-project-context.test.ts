import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveProjectRouteId: vi.fn(),
  getProjectAccessRecord: vi.fn(),
}))
vi.mock("@/lib/project-route-id", () => ({ resolveProjectRouteId: mocks.resolveProjectRouteId }))
vi.mock("@/lib/project-access", () => ({ getProjectAccessRecord: mocks.getProjectAccessRecord }))

import {
  currentProjectPrompt,
  projectRouteSegment,
  resolveCurrentProjectContext,
} from "../current-project-context"
import type { AuthUser } from "@/lib/auth"
import type { getDb } from "@/db"

const user = { id: "user-1", organizationId: "org-1" } as unknown as AuthUser

function dbReturning(row: { readonly name: string } | undefined): ReturnType<typeof getDb> {
  const chain = { from: () => chain, where: () => chain, get: async () => row }
  return { select: () => chain } as unknown as ReturnType<typeof getDb>
}

afterEach(() => vi.clearAllMocks())

describe("current project context for Jarvis", () => {
  it("recognizes project pages, including nested ones", () => {
    expect(projectRouteSegment("/dashboard/projects/abc")).toBe("abc")
    expect(projectRouteSegment("/dashboard/projects/abc/daily-logs?x=1")).toBe("abc")
    expect(projectRouteSegment("/dashboard/projects")).toBeNull()
    expect(projectRouteSegment("/dashboard/help/daily-logs")).toBeNull()
  })

  it("names the project and tells Jarvis what 'this job' means", () => {
    const prompt = currentProjectPrompt({ id: "p1", projectNumber: "H-DEV-001", name: "Compass Developer" })
    expect(prompt).toContain("H-DEV-001 · Compass Developer (project ID: p1)")
    expect(prompt).toContain('"this job"')
  })

  it("describes an accessible project the user is viewing", async () => {
    mocks.resolveProjectRouteId.mockResolvedValue("p1")
    mocks.getProjectAccessRecord.mockResolvedValue({ id: "p1", organizationId: "org-1", projectNumber: "H-DEV-001" })
    const context = await resolveCurrentProjectContext(
      dbReturning({ name: "Compass Developer" }),
      user,
      "/dashboard/projects/compass-developer/daily-logs"
    )
    expect(context).toContain("H-DEV-001 · Compass Developer")
    expect(mocks.getProjectAccessRecord).toHaveBeenCalledWith(expect.anything(), user, "p1")
  })

  it("gives no context for projects the user can't access", async () => {
    mocks.resolveProjectRouteId.mockResolvedValue("secret")
    mocks.getProjectAccessRecord.mockResolvedValue(null)
    const db = dbReturning({ name: "Secret Project" })
    expect(await resolveCurrentProjectContext(db, user, "/dashboard/projects/secret")).toBeNull()
  })

  it("gives no context off project pages or when lookups fail", async () => {
    expect(await resolveCurrentProjectContext(dbReturning(undefined), user, "/dashboard")).toBeNull()
    expect(mocks.resolveProjectRouteId).not.toHaveBeenCalled()
    mocks.resolveProjectRouteId.mockRejectedValue(new Error("db down"))
    expect(await resolveCurrentProjectContext(dbReturning(undefined), user, "/dashboard/projects/x")).toBeNull()
  })
})
