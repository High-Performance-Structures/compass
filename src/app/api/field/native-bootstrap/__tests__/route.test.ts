import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getActiveFieldProjects: vi.fn(),
  getFieldProjectPacket: vi.fn(),
  currentDepartmentProfiles: vi.fn(),
}))

vi.mock("@/app/actions/field-mode", () => ({
  getActiveFieldProjects: mocks.getActiveFieldProjects,
  getFieldProjectPacket: mocks.getFieldProjectPacket,
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/department-profiles-server", () => ({
  currentDepartmentProfiles: mocks.currentDepartmentProfiles,
}))

import { GET } from "../route"

const profile = (code: string): Record<string, string | null> => ({
  displayName: `Company ${code}`,
  shortName: code,
  logoDataUrl: null,
})

const projects = [
  { id: "project-1", name: "First", projectNumber: "O-1", address: null, department: "O" },
  { id: "project-2", name: "Second", projectNumber: "O-2", address: null, department: "O" },
]

describe("GET /api/field/native-bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      displayName: "Field User",
      email: "field@example.com",
      role: "field",
    })
    mocks.getActiveFieldProjects.mockResolvedValue(projects)
    mocks.currentDepartmentProfiles.mockResolvedValue({
      O: profile("O"),
      H: profile("H"),
      N: profile("N"),
      D: profile("D"),
    })
    mocks.getFieldProjectPacket.mockResolvedValue({ project: projects[1] })
  })

  it("builds the requested project's packet for sign-in and older builds", async () => {
    const response = await GET(
      new NextRequest("https://compass.example/api/field/native-bootstrap?projectId=project-2")
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.getFieldProjectPacket).toHaveBeenCalledWith("project-2")
    expect(body).toMatchObject({
      success: true,
      projects,
      initialPacket: { project: projects[1] },
    })
  })

  it("returns only the list, profile and companies when listOnly=1", async () => {
    const response = await GET(
      new NextRequest(
        "https://compass.example/api/field/native-bootstrap?listOnly=1&refresh=123"
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mocks.getFieldProjectPacket).not.toHaveBeenCalled()
    expect(body).toEqual({
      success: true,
      profile: { name: "Field User", email: "field@example.com", role: "field" },
      projects,
      initialPacket: null,
      companies: {
        O: profile("O"),
        H: profile("H"),
        N: profile("N"),
        D: profile("D"),
      },
    })
  })

  it("reports an ended session as 401 so the shell asks for sign-in", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("Unauthorized"))
    const response = await GET(
      new NextRequest("https://compass.example/api/field/native-bootstrap?listOnly=1")
    )
    expect(response.status).toBe(401)
  })
})
