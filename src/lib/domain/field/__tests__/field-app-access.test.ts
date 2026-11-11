import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import {
  assertFieldAppProjectAccess,
  FIELD_PROJECT_NOT_ASSIGNED,
  FIELD_PROJECT_NOT_IN_APP,
  listFieldAppProjects,
  loadCompanyFieldAppJobs,
} from "@/lib/domain/field/field-app-access"

/*
 * Field app access on the real migrated schema: which jobs each person's
 * list shows, and that opening a single job agrees with the list.
 */

let sqlite: Sqlite
let db: ReturnType<typeof getDb>

const NOW = "2026-11-10T00:00:00.000Z"

// id, number, department, project status, job status, field app choice
const JOBS: readonly (readonly [string, string, string, string, string, string | null])[] = [
  ["building", "O-101-AAA", "O", "OPEN", "current", null],
  ["precon", "O-102-BBB", "O", "OTHER", "contract_docs_signed", null],
  ["precon-shown", "O-103-CCC", "O", "OTHER", "contract_docs_signed", "shown"],
  ["hidden", "H-104-DDD", "H", "OPEN", "under_construction", "hidden"],
  ["finished", "O-105-EEE", "O", "OPEN", "complete", "shown"],
  ["archived", "O-106-FFF", "O", "COMPLETE", "current", null],
  ["material", "N-107-GGG", "N", "OPEN", "current", null],
  ["warranty", "H-108-HHH", "H", "OPEN", "under_warranty", null],
  ["estimating", "O-109-III", "O", "OPEN", "estimating", null],
]

function sqlString(value: string | null): string {
  return value === null ? "NULL" : `'${value}'`
}

function user(id: string, role: string, organizationId = "org"): AuthUser {
  return {
    id,
    email: `${id}@example.test`,
    firstName: null,
    lastName: null,
    displayName: id,
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId,
    organizationName: "Example Builders",
    organizationType: "internal",
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function setSettings(value: Record<string, unknown>, key = "field-app"): void {
  sqlite
    .prepare("INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org', ?, ?, ?)")
    .run(key, JSON.stringify(value), NOW)
}

async function listedIds(viewer: AuthUser): Promise<readonly string[]> {
  return (await listFieldAppProjects(db, viewer)).map((project) => project.id).sort()
}

/** Every job the single-job check lets this person open. */
async function openableIds(viewer: AuthUser): Promise<readonly string[]> {
  const ids = [...JOBS.map(([id]) => id), "other-company"]
  const results = await Promise.all(
    ids.map((id) => assertFieldAppProjectAccess(db, viewer, id).then(() => id, () => null)),
  )
  return results.filter((id): id is string => id !== null).sort()
}

beforeEach(() => {
  sqlite = migratedSqlite()
  db = getDb(d1(sqlite))
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES
      ('org', 'Example Builders', 'example', 'internal', 1, '${NOW}', '${NOW}'),
      ('other', 'Other Builders', 'other', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
      ('employee', 'employee@example.test', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('numbered', 'numbered@example.test', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('no-sage', 'no-sage@example.test', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('archived-contact', 'archived@example.test', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('trade', 'trade@example.test', 'subcontractor', 1, '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('m1', 'org', 'employee', 'field_crew', '${NOW}'),
      ('m2', 'org', 'numbered', 'field_superintendent', '${NOW}'),
      ('m3', 'org', 'no-sage', 'field_crew', '${NOW}'),
      ('m4', 'org', 'archived-contact', 'field_crew', '${NOW}'),
      ('m5', 'org', 'trade', 'subcontractor', '${NOW}');
    INSERT INTO internal_contacts (id, organization_id, user_id, name, sage_employee_id, sage_employee_number, active, created_at, updated_at) VALUES
      ('c1', 'org', 'employee', 'Crew One', 'EMP-1', NULL, 1, '${NOW}', '${NOW}'),
      ('c2', 'org', 'numbered', 'Crew Two', NULL, '17', 1, '${NOW}', '${NOW}'),
      ('c3', 'org', 'no-sage', 'Crew Three', '  ', NULL, 1, '${NOW}', '${NOW}'),
      ('c4', 'org', 'archived-contact', 'Crew Four', 'EMP-4', NULL, 0, '${NOW}', '${NOW}'),
      ('c5', 'org', 'trade', 'Trade Partner', 'EMP-5', NULL, 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, department, project_number, status, job_status_id, created_at, updated_at) VALUES
      ('other-company', 'Other job', 'other', 'O', 'O-900-ZZZ', 'OPEN', 'current', '${NOW}', '${NOW}');
  `)
  for (const [id, number, department, status, jobStatus, choice] of JOBS) {
    sqlite.exec(`INSERT INTO projects (id, name, organization_id, department, project_number, status, job_status_id, field_app_visibility, created_at, updated_at)
      VALUES ('${id}', 'Job ${id}', 'org', '${department}', '${number}', '${status}', '${jobStatus}', ${sqlString(choice)}, '${NOW}', '${NOW}')`)
  }
  // Members of the precon job and of the hidden job; the trade partner is on the building job.
  sqlite.exec(`
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
      ('pm1', 'precon', 'no-sage', 'field_crew', '${NOW}'),
      ('pm2', 'building', 'no-sage', 'field_crew', '${NOW}'),
      ('pm3', 'hidden', 'no-sage', 'field_crew', '${NOW}'),
      ('pm4', 'building', 'trade', 'subcontractor', '${NOW}'),
      ('pm5', 'other-company', 'employee', 'field_crew', '${NOW}');
  `)
})

describe("field app job list", () => {
  it("shows an active Sage employee every switched-on job of their company without membership", async () => {
    // Construction and closeout phases on Automatic, Always show in precon,
    // plus the other company's job through an explicit membership.
    expect(await listedIds(user("employee", "field_crew"))).toEqual(["building", "other-company", "precon-shown", "warranty"])
    // A Sage employee number is enough.
    expect(await listedIds(user("numbered", "field_superintendent"))).toEqual(["building", "precon-shown", "warranty"])
  })

  it("hides switched-off, closed, precon, excluded-department and estimating jobs", async () => {
    const listed = await listedIds(user("employee", "field_crew"))
    for (const id of ["hidden", "finished", "archived", "precon", "material", "estimating"]) {
      expect(listed).not.toContain(id)
    }
  })

  it("gives an inactive contact or one without a Sage link their memberships only", async () => {
    // The precon member keeps nothing for precon (Automatic hides it) and the hidden job stays hidden.
    expect(await listedIds(user("no-sage", "field_crew"))).toEqual(["building"])
    expect(await listedIds(user("archived-contact", "field_crew"))).toEqual([])
  })

  it("never widens access for external roles", async () => {
    expect(await listedIds(user("trade", "subcontractor"))).toEqual(["building"])
    const client = { ...user("trade", "client"), organizationType: "client" }
    expect(await listedIds(client)).toEqual(["building"])
  })

  it("restores membership-only access when the company setting is off", async () => {
    setSettings({ autoAccessForSageEmployees: false })
    expect(await listedIds(user("employee", "field_crew"))).toEqual(["other-company"])
  })

  it("follows the company's phase mapping and department settings", async () => {
    // Moving "Contract Docs Signed" into construction in Settings › Portfolio map brings the job in.
    setSettings({ statusPhases: { contract_docs_signed: "construction" } }, "portfolio-map")
    setSettings({ excludedDepartments: [] })
    expect(await listedIds(user("employee", "field_crew"))).toEqual([
      "building",
      "material",
      "other-company",
      "precon",
      "precon-shown",
      "warranty",
    ])
  })

  it("lists every job that isn't closed for the settings checklist", async () => {
    const { jobs } = await loadCompanyFieldAppJobs(db, "org")
    expect(jobs.map((job) => job.id).sort()).toEqual(["building", "estimating", "hidden", "material", "precon", "precon-shown", "warranty"])
    const precon = jobs.find((job) => job.id === "precon")
    expect(precon?.decision).toMatchObject({ shown: false, choice: "automatic", reason: "automatic_phase_not_included" })
  })
})

describe("single field app job checks", () => {
  it("match the list for every person", async () => {
    for (const viewer of [
      user("employee", "field_crew"),
      user("numbered", "field_superintendent"),
      user("no-sage", "field_crew"),
      user("archived-contact", "field_crew"),
      user("trade", "subcontractor"),
    ]) {
      expect(await openableIds(viewer)).toEqual(await listedIds(viewer))
    }
    setSettings({ autoAccessForSageEmployees: false })
    expect(await openableIds(user("employee", "field_crew"))).toEqual(await listedIds(user("employee", "field_crew")))
  })

  it("explains why a job can't be opened", async () => {
    await expect(assertFieldAppProjectAccess(db, user("employee", "field_crew"), "precon")).rejects.toThrow(FIELD_PROJECT_NOT_IN_APP)
    await expect(assertFieldAppProjectAccess(db, user("no-sage", "field_crew"), "warranty")).rejects.toThrow(FIELD_PROJECT_NOT_ASSIGNED)
    await expect(assertFieldAppProjectAccess(db, user("trade", "subcontractor"), "warranty")).rejects.toThrow(FIELD_PROJECT_NOT_ASSIGNED)
    const opened = await assertFieldAppProjectAccess(db, user("employee", "field_crew"), "building")
    expect(opened.via).toBe("employee")
  })

  it("shows a precon job once it is set to Always show", async () => {
    sqlite.exec("UPDATE projects SET field_app_visibility = 'shown' WHERE id = 'precon'")
    expect(await listedIds(user("employee", "field_crew"))).toContain("precon")
    expect(await listedIds(user("no-sage", "field_crew"))).toContain("precon")
  })
})
