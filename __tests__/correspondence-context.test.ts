import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  isDemoUser: vi.fn(() => false),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/demo", () => ({ isDemoUser: mocks.isDemoUser }))

import { correspondenceContext, isCorrespondenceEnabled } from "@/lib/correspondence/access"

import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"

describe("correspondenceContext organization and project access", () => {
  let database: CorrespondenceTestDatabase | null = null

  afterEach(() => {
    database?.close()
    database = null
    vi.clearAllMocks()
  })

  function open(): CorrespondenceTestDatabase {
    database = openCorrespondenceTestDatabase()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1, COMPASS_CORRESPONDENCE_PROJECT_IDS: "project-a" } })
    return database
  }

  function authenticate(database: CorrespondenceTestDatabase, options: {
    readonly userId?: "owner-a" | "staff-a"
    readonly activeOrganizationId?: "org-a" | "org-b"
    readonly activeOrganizationType?: "internal" | "client"
    readonly activeRole?: string
  } = {}): void {
    const userId = options.userId ?? "owner-a"
    const activeOrganizationId = options.activeOrganizationId ?? "org-a"
    const user = context(database, userId, "project-a").user
    mocks.requireAuth.mockResolvedValue({
      ...user,
      organizationId: activeOrganizationId,
      organizationType: options.activeOrganizationType ?? (activeOrganizationId === "org-a" ? "client" : "internal"),
      role: options.activeRole ?? user.role,
    })
  }

  it("keeps an owner workspace when the active shell organization is another internal organization", async () => {
    const db = open()
    authenticate(db, { activeOrganizationId: "org-b", activeOrganizationType: "internal", activeRole: "admin" })

    const result = await correspondenceContext("project-a")

    expect(result.organizationId).toBe("org-a")
    expect(result.workspace).toBe("owner")
  })

  it("classifies a target-organization supplier as sub_vendor", async () => {
    const db = open()
    db.sqlite.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?").run("supplier", "project-a", "owner-a")
    authenticate(db, { activeOrganizationId: "org-b", activeOrganizationType: "internal", activeRole: "admin" })

    const result = await correspondenceContext("project-a")

    expect(result.organizationId).toBe("org-a")
    expect(result.workspace).toBe("sub_vendor")
  })

  it("denies an active other-organization admin without project membership", async () => {
    const db = open()
    db.sqlite.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run("project-a", "owner-a")
    authenticate(db, { activeOrganizationId: "org-b", activeOrganizationType: "internal", activeRole: "admin" })

    await expect(correspondenceContext("project-a")).rejects.toThrow("Project not found")
  })

  it("denies a project invite without membership in the target organization", async () => {
    const db = open()
    db.sqlite.prepare("DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?").run("org-a", "owner-a")
    authenticate(db, { activeOrganizationId: "org-b", activeOrganizationType: "internal", activeRole: "admin" })

    await expect(correspondenceContext("project-a")).rejects.toThrow("Project not found")
  })

  it("keeps project authorization enforced during a general native rollout", async () => {
    const db = open()
    authenticate(db)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: db.d1, COMPASS_CORRESPONDENCE_ENABLED: "true" } })
    expect(isCorrespondenceEnabled("project-b", { COMPASS_CORRESPONDENCE_ENABLED: "true" })).toBe(true)
    await expect(correspondenceContext("project-b")).rejects.toThrow("Project not found")
    expect(isCorrespondenceEnabled("project-a", { COMPASS_CORRESPONDENCE_ENABLED: "false" })).toBe(false)
  })

  it("allows broad internal staff scope with target organization membership and no project row", async () => {
    const db = open()
    db.sqlite.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run("project-a", "staff-a")
    authenticate(db, { userId: "staff-a", activeOrganizationId: "org-a", activeOrganizationType: "internal", activeRole: "admin" })

    const result = await correspondenceContext("project-a")

    expect(result.organizationId).toBe("org-a")
    expect(result.workspace).toBe("staff")
  })
})
