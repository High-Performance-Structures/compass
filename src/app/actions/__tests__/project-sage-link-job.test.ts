import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

const mocks = vi.hoisted(() => ({ audit: vi.fn(), activity: vi.fn(), role: "admin" }))
let database: CorrespondenceTestDatabase

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/server/action-context", () => ({
  projectContext: async () => ({
    success: true,
    data: {
      db: database.db,
      env: { DB: database.d1 },
      organizationId: "org-a",
      user: { id: "staff-a", role: mocks.role, organizationType: "internal" },
    },
  }),
}))
vi.mock("@/lib/domain/project-audit/store", () => ({ recordProjectAudit: mocks.audit }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.activity }))
vi.mock("@/lib/sage/estimate-sync", () => ({ estimateExportsFollowJobStatements: () => [] }))

import { linkProjectToExistingSageJob } from "../project-sage-send"

beforeEach(() => {
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec(`
    ALTER TABLE projects ADD COLUMN sage_job_number TEXT;
    ALTER TABLE projects ADD COLUMN updated_at TEXT;
    CREATE TABLE sage_client_project_write_operations (
      id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, customer_id TEXT,
      operation_type TEXT, status TEXT, error_message TEXT, payload_json TEXT
    );
    INSERT INTO projects (id, organization_id, name, project_number, sage_job_number)
      VALUES ('p-ezell', 'org-a', 'Ezell Residence', 'H-430-1900', NULL),
             ('p-other', 'org-a', 'Loeffler', 'O-202', '722');
  `)
})

afterEach(() => {
  database.close()
  mocks.role = "admin"
  vi.clearAllMocks()
})

function sageJobNumber(id: string): unknown {
  return database.sqlite.prepare("SELECT sage_job_number AS n FROM projects WHERE id = ?").get(id)
}

describe("link existing Sage job", () => {
  it("records the Sage job number and logs who linked it", async () => {
    await expect(linkProjectToExistingSageJob("p-ezell", " 731 ")).resolves.toEqual({ success: true })
    expect(sageJobNumber("p-ezell")).toEqual({ n: "731" })
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.activity).toHaveBeenCalledOnce()
  })

  it("refuses a number another job already uses, or one that isn't a number", async () => {
    const taken = await linkProjectToExistingSageJob("p-ezell", "722")
    expect(taken).toEqual({ success: false, error: "Sage job 722 is already linked to O-202 Loeffler." })
    expect((await linkProjectToExistingSageJob("p-ezell", "J-7")).success).toBe(false)
    expect(sageJobNumber("p-ezell")).toEqual({ n: null })
  })

  it("never overwrites an existing link or races a job Compass is creating", async () => {
    expect((await linkProjectToExistingSageJob("p-other", "731")).success).toBe(false)
    database.sqlite.exec(`INSERT INTO sage_client_project_write_operations VALUES
      ('w1', 'org-a', 'p-ezell', 'c1', 'ensure_client_and_job', 'queued', NULL, '{}')`)
    expect((await linkProjectToExistingSageJob("p-ezell", "731")).success).toBe(false)
    expect(sageJobNumber("p-ezell")).toEqual({ n: null })
  })

  it("is for office staff only", async () => {
    mocks.role = "owner"
    expect((await linkProjectToExistingSageJob("p-ezell", "731")).success).toBe(false)
  })
})
