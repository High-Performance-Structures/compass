import { beforeEach, describe, expect, it, vi } from "vitest"

import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), cloudflare: vi.fn(), access: vi.fn(), canFeature: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/domain/project/access", () => ({ getProjectAccessRecord: mocks.access }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature, requireFeaturePermission: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getFieldAppJobChecklist } from "../field-app-settings"
import { updateProjectFieldAppVisibility } from "../project-profile"

/*
 * Settings › Workflows › Field app and the Information page share one
 * per-job choice: Automatic (null), Always show or Hide.
 */

let sqlite: Sqlite
const NOW = "2026-11-10T00:00:00.000Z"

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org', 'Example', 'example', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('staff', 'staff@example.test', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, department, project_number, status, job_status_id, created_at, updated_at) VALUES
      ('precon', 'Precon job', 'org', 'H', 'H-412-AAA', 'OTHER', 'contract_docs_signed', '${NOW}', '${NOW}'),
      ('closed', 'Closed job', 'org', 'O', 'O-100-BBB', 'OPEN', 'closed', '${NOW}', '${NOW}');
  `)
  mocks.auth.mockResolvedValue({
    id: "staff", email: "staff@example.test", displayName: "Example Manager", role: "project_manager",
    organizationId: "org", organizationType: "internal", isActive: true,
  })
  mocks.cloudflare.mockResolvedValue({ env: { DB: d1(sqlite) } })
  mocks.access.mockResolvedValue({ id: "precon", organizationId: "org", projectNumber: "H-412-AAA" })
  mocks.canFeature.mockResolvedValue(true)
})

describe("field app choice", () => {
  it("lists not-closed jobs and switches a precon job on with Always show", async () => {
    const before = await getFieldAppJobChecklist()
    expect(before.success && before.data.jobs.map((job) => [job.id, job.choice, job.shown])).toEqual([["precon", "automatic", false]])

    expect(await updateProjectFieldAppVisibility({ projectId: "precon", choice: "shown" })).toEqual({ success: true })
    expect(sqlite.prepare("SELECT field_app_visibility AS v FROM projects WHERE id = 'precon'").get()).toEqual({ v: "shown" })
    const after = await getFieldAppJobChecklist()
    expect(after.success && after.data.jobs[0]).toMatchObject({ choice: "shown", shown: true })
    expect(sqlite.prepare("SELECT event_type FROM project_profile_audit_events").all()).toEqual([
      { event_type: "project_field_app_visibility_updated" },
    ])

    // Back to Automatic stores null.
    expect(await updateProjectFieldAppVisibility({ projectId: "precon", choice: "automatic" })).toEqual({ success: true })
    expect(sqlite.prepare("SELECT field_app_visibility AS v FROM projects WHERE id = 'precon'").get()).toEqual({ v: null })
  })

  it("rejects unknown choices and people without project-hub update", async () => {
    expect((await updateProjectFieldAppVisibility({ projectId: "precon", choice: "always" })).success).toBe(false)
    mocks.canFeature.mockResolvedValue(false)
    expect((await updateProjectFieldAppVisibility({ projectId: "precon", choice: "hidden" })).success).toBe(false)
    expect(sqlite.prepare("SELECT field_app_visibility AS v FROM projects WHERE id = 'precon'").get()).toEqual({ v: null })
  })

  it("keeps the checklist to internal staff", async () => {
    mocks.auth.mockResolvedValue({ id: "staff", email: "staff@example.test", role: "subcontractor", organizationId: "org", organizationType: "internal", isActive: true })
    expect((await getFieldAppJobChecklist()).success).toBe(false)
  })
})
