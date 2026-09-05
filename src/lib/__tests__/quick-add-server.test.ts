import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  canFeature: vi.fn(async (_user: unknown, _featureId: string, _action: string) => true),
  isDemoOrg: vi.fn(() => false),
  isDemoUser: vi.fn(() => false),
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))
vi.mock("@/lib/demo", () => ({
  isDemoOrg: mocks.isDemoOrg,
  isDemoUser: mocks.isDemoUser,
}))

import type { ProjectListItem } from "@/app/actions/projects"
import type { AuthUser } from "@/lib/auth"
import { getQuickAddProjects } from "@/lib/quick-add-server"
import {
  context,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../__tests__/helpers/correspondence-core"

function project(id: string, name = id): ProjectListItem {
  return {
    id,
    name,
    projectNumber: id,
    clientName: null,
    googleDriveFolderId: null,
    status: "OPEN",
    clientStatus: "active",
    jobStatusId: "active",
    jobStatusLabel: "Active",
    createdAt: "2026-09-05T12:00:00.000Z",
  }
}

function authUser(
  database: CorrespondenceTestDatabase,
  userId: "staff-a" | "owner-a",
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return {
    ...context(database, userId, "project-a").user,
    organizationType: userId === "staff-a" ? "internal" : "client",
    ...overrides,
  }
}

describe("getQuickAddProjects", () => {
  let database: CorrespondenceTestDatabase | null = null

  afterEach(() => {
    database?.close()
    database = null
    vi.clearAllMocks()
    mocks.canFeature.mockResolvedValue(true)
    mocks.isDemoOrg.mockReturnValue(false)
    mocks.isDemoUser.mockReturnValue(false)
  })

  function open(): CorrespondenceTestDatabase {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(`
      CREATE TABLE project_access_invitations (
        id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL, project_contact_id TEXT, email TEXT NOT NULL,
        role TEXT NOT NULL, status TEXT NOT NULL, accepted_by TEXT,
        accepted_at TEXT, invited_by TEXT NOT NULL, invited_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `)
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: database.d1, COMPASS_CORRESPONDENCE_ENABLED: "true" },
    })
    return database
  }

  it("returns all granted internal destinations only for active-org projects", async () => {
    const db = open()
    const result = await getQuickAddProjects(
      authUser(db, "staff-a"),
      [project("project-a", "Allowed"), project("project-other", "Cross org")],
    )

    expect(result).toEqual([
      {
        id: "project-a",
        name: "Allowed",
        projectNumber: "project-a",
        actions: [
          { action: "message", href: "/dashboard/projects/project-a/messages?quickAdd=message" },
          { action: "daily-log", href: "/dashboard/projects/project-a/daily-logs?quickAdd=daily-log" },
          { action: "todo", href: "/dashboard/projects/project-a/todos?quickAdd=todo" },
          { action: "schedule-item", href: "/dashboard/projects/project-a/schedule?quickAdd=schedule-item" },
          { action: "rfi", href: "/dashboard/projects/project-a/rfis?quickAdd=rfi" },
          { action: "purchase-order", href: "/dashboard/projects/project-a/purchase-orders?quickAdd=purchase-order" },
          { action: "rfq", href: "/dashboard/projects/project-a/rfqs?quickAdd=rfq" },
        ],
      },
    ])
  })

  it.each(["purchase-orders", "rfqs"])(
    "independently hides procurement shortcuts without %s update permission",
    async (deniedFeature) => {
      const db = open()
      mocks.canFeature.mockImplementation(async (_user, featureId, action) =>
        featureId !== deniedFeature || action !== "update",
      )
      const result = await getQuickAddProjects(authUser(db, "staff-a"), [project("project-a")])
      const actions = result[0]?.actions.map((item) => item.action)
      expect(actions).not.toContain(deniedFeature === "rfqs" ? "rfq" : "purchase-order")
      expect(actions).toContain(deniedFeature === "rfqs" ? "purchase-order" : "rfq")
      expect(actions).toContain("message")
    },
  )

  it("keeps an invited owner message scoped to the target project organization", async () => {
    const db = open()
    const result = await getQuickAddProjects(
      authUser(db, "owner-a", {
        organizationId: "org-b",
        organizationName: "Other active organization",
        organizationType: "internal",
        role: "admin",
      }),
      [project("project-a")],
    )

    expect(result).toEqual([
      {
        id: "project-a",
        name: "project-a",
        projectNumber: "project-a",
        actions: [{
          action: "message",
          href: "/preview/projects/project-a/owner/conversations?quickAdd=message",
        }],
      },
    ])
  })

  it("classifies staff from the project organization instead of the active shell", async () => {
    const db = open()
    db.sqlite.prepare(
      "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
    ).run("project_manager", "org-a", "owner-a")
    db.sqlite.prepare(
      "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
    ).run("staff", "project-a", "owner-a")

    const result = await getQuickAddProjects(
      authUser(db, "owner-a", {
        organizationId: "org-b",
        organizationName: "Other active organization",
        organizationType: "internal",
        role: "admin",
      }),
      [project("project-a")],
    )

    expect(result[0]?.actions).toEqual([{
      action: "message",
      href: "/dashboard/projects/project-a/messages?quickAdd=message",
    }])
  })

  it("denies a cross-organization project without explicit project access", async () => {
    const db = open()
    db.sqlite.prepare(
      "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
    ).run("project_manager", "org-a", "owner-a")
    db.sqlite.prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    ).run("project-a", "owner-a")

    await expect(getQuickAddProjects(
      authUser(db, "owner-a", {
        organizationId: "org-b",
        organizationName: "Other active organization",
        organizationType: "internal",
        role: "admin",
      }),
      [project("project-a")],
    )).resolves.toEqual([])
  })

  it("denies a project member who is not in the target organization", async () => {
    const db = open()
    db.sqlite.prepare(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
    ).run("org-a", "owner-a")

    await expect(getQuickAddProjects(
      authUser(db, "owner-a"),
      [project("project-a")],
    )).resolves.toEqual([])
  })

  it("grants sub/vendor RFI only when its verified project contact exists", async () => {
    const db = open()
    db.sqlite.prepare(
      "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
    ).run("supplier", "project-a", "owner-a")

    const user = authUser(db, "owner-a")
    const beforeContact = await getQuickAddProjects(user, [project("project-a")])
    expect(beforeContact[0]?.actions.map((item) => item.action)).toEqual(["message"])

    db.sqlite.prepare(`
      INSERT INTO project_contacts (
        id, project_id, contact_type, display_name, email, active
      ) VALUES (?, ?, ?, ?, ?, 1)
    `).run("contact-a", "project-a", "supplier", "Supplier A", user.email)

    const afterContact = await getQuickAddProjects(user, [project("project-a")])
    expect(afterContact[0]?.actions).toEqual([
      {
        action: "message",
        href: "/preview/projects/project-a/sub-vendor/conversations?quickAdd=message",
      },
      {
        action: "rfi",
        href: "/preview/projects/project-a/sub-vendor/rfis?quickAdd=rfi",
      },
    ])
  })

  it("does not use correspondence organization membership to widen or deny RFI", async () => {
    const db = open()
    db.sqlite.prepare(
      "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
    ).run("subcontractor", "project-a", "owner-a")
    db.sqlite.prepare(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
    ).run("org-a", "owner-a")
    db.sqlite.prepare(`
      INSERT INTO project_contacts (
        id, project_id, contact_type, display_name, email, active
      ) VALUES (?, ?, ?, ?, ?, 1)
    `).run(
      "contact-a",
      "project-a",
      "subcontractor",
      "Subcontractor A",
      "owner-a@example.test",
    )

    const result = await getQuickAddProjects(
      authUser(db, "owner-a"),
      [project("project-a")],
    )
    expect(result[0]?.actions).toEqual([{
      action: "rfi",
      href: "/preview/projects/project-a/sub-vendor/rfis?quickAdd=rfi",
    }])
  })

  it("fails closed when data access is unavailable", async () => {
    const db = open()
    mocks.getCloudflareContext.mockRejectedValue(new Error("D1 unavailable"))
    await expect(getQuickAddProjects(authUser(db, "staff-a"), [project("project-a")]))
      .resolves.toEqual([])
  })
})
