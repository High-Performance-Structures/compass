import { beforeEach, describe, expect, it, vi } from "vitest"

import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  cloudflare: vi.fn(),
  revalidatePath: vi.fn(),
  recordActivityEvent: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.user, getCurrentUser: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: async () => true, requireFeaturePermission: vi.fn() }))
vi.mock("@/lib/project-audience-request-server", () => ({
  assertAudiencePreviewWriteAllowed: vi.fn(),
  requireProjectAudienceReadUser: mocks.user,
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

const { createProjectDailyLog, updateDailyLogReview, updateProjectDailyLog } = await import("../project-field")
const { deleteProjectDailyLogs } = await import("../daily-log-delete")

const STAMP = "2026-10-26T00:00:00.000Z"
let sqlite: Sqlite

const staff = {
  id: "staff",
  email: "staff@example.test",
  displayName: "Example Staff",
  role: "admin",
  organizationId: "org",
  organizationType: "internal",
  isActive: true,
}

const logInput = {
  logDate: "2026-10-26",
  weatherTempF: 61,
  weatherConditions: " Clear ",
  weatherPrecipitation: "",
  workCompleted: " Set trusses ",
  issues: "",
  materialsUsed: " Lumber ",
  crewPresent: "",
  hoursWorked: 6,
  safetyIncidents: "",
  visitorLog: "",
  notes: "",
}

function rows(sql: string): readonly Record<string, unknown>[] {
  return sqlite.prepare(sql).all()
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES ('org','Example','example','internal',1,'${STAMP}','${STAMP}');
    INSERT INTO users (id,email,role,is_active,created_at,updated_at) VALUES ('staff','staff@example.test','admin',1,'${STAMP}','${STAMP}'),('other','other@example.test','admin',1,'${STAMP}','${STAMP}');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES ('job','Job','org','O','${STAMP}','${STAMP}'),('peer','Peer','org','O','${STAMP}','${STAMP}');
  `)
  mocks.user.mockResolvedValue(staff)
  mocks.cloudflare.mockResolvedValue({ env: { DB: d1(sqlite) } })
})

describe("daily log actions", () => {
  it("creates a log once per client submission id", async () => {
    const input = { ...logInput, clientSubmissionId: "11111111-1111-4111-8111-111111111111" }
    expect(await createProjectDailyLog("job", input)).toEqual({ success: true, dailyLogId: input.clientSubmissionId })
    expect(rows("SELECT id, work_completed, weather_conditions, weather_precipitation, materials_used, hours_worked, review_status, is_client_visible, weather_source FROM daily_logs")).toEqual([
      {
        id: input.clientSubmissionId,
        work_completed: "Set trusses",
        weather_conditions: "Clear",
        weather_precipitation: null,
        materials_used: "Lumber",
        hours_worked: 6,
        review_status: "needs_review",
        is_client_visible: 0,
        weather_source: "manual",
      },
    ])
    const paths = mocks.revalidatePath.mock.calls.map(([path]) => path)
    expect(paths).toEqual(["/dashboard/projects/job", "/dashboard/projects/job/daily-logs", "/dashboard/projects/job/owner-updates"])

    mocks.revalidatePath.mockClear()
    expect(await createProjectDailyLog("job", input)).toEqual({ success: true, dailyLogId: input.clientSubmissionId })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(rows("SELECT COUNT(*) AS n FROM daily_logs")).toEqual([{ n: 1 }])

    mocks.user.mockResolvedValue({ ...staff, id: "other" })
    expect(await createProjectDailyLog("job", input)).toEqual({
      success: false,
      error: "Daily log submission ID is already in use.",
    })
  })

  it("keeps the validation messages", async () => {
    expect(await createProjectDailyLog("job", { ...logInput, workCompleted: "  " })).toEqual({
      success: false,
      error: "Work completed is required.",
    })
    expect(await createProjectDailyLog("job", { ...logInput, logDate: "10/26/2026" })).toEqual({
      success: false,
      error: "Enter a valid daily log date.",
    })
    mocks.user.mockResolvedValue({ ...staff, role: "client" })
    expect(await createProjectDailyLog("job", logInput)).toEqual({
      success: false,
      error: "Permission denied: staff access is required for daily logs",
    })
  })

  it("moves a log, its files and to-dos to another project and drops its schedule links", async () => {
    sqlite.exec(`
      INSERT INTO daily_logs (id,project_id,author_id,log_date,work_completed,review_status,is_client_visible,created_at,updated_at) VALUES ('log','job','other','2026-10-20','Old','approved',1,'${STAMP}','${STAMP}');
      INSERT INTO daily_log_photos (id,project_id,daily_log_id,file_name,review_status,owner_visible,sub_vendor_visible,created_at,updated_at) VALUES ('photo','job','log','a.jpg','approved',1,1,'${STAMP}','${STAMP}');
      INSERT INTO schedule_tasks (id,project_id,title,start_date,workdays,end_date_calculated,phase,created_at,updated_at) VALUES ('task','job','Frame','2026-10-20',1,'2026-10-20','Framing','${STAMP}','${STAMP}');
      INSERT INTO daily_log_task_links (id,daily_log_id,schedule_task_id,created_at) VALUES ('link','log','task','${STAMP}');
      INSERT INTO project_operations (id,project_id,source_record_type,source_record_id,title,created_at,updated_at) VALUES ('todo','job','staff_task','log','Follow up','${STAMP}','${STAMP}');
    `)
    expect(await updateProjectDailyLog("job", { ...logInput, dailyLogId: "log", targetProjectId: "peer" })).toEqual({
      success: true,
      projectId: "peer",
    })
    expect(rows("SELECT project_id, work_completed, review_status, is_client_visible, author_id FROM daily_logs")).toEqual([
      { project_id: "peer", work_completed: "Set trusses", review_status: "needs_review", is_client_visible: 0, author_id: "other" },
    ])
    expect(rows("SELECT project_id, review_status, owner_visible, sub_vendor_visible FROM daily_log_photos")).toEqual([
      { project_id: "peer", review_status: "needs_review", owner_visible: 0, sub_vendor_visible: 0 },
    ])
    expect(rows("SELECT project_id FROM project_operations")).toEqual([{ project_id: "peer" }])
    expect(rows("SELECT COUNT(*) AS n FROM daily_log_task_links")).toEqual([{ n: 0 }])
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/dashboard/projects/job",
      "/dashboard/projects/job/daily-logs",
      "/dashboard/projects/job/owner-updates",
      "/dashboard/projects/peer",
      "/dashboard/projects/peer/daily-logs",
      "/dashboard/projects/peer/owner-updates",
    ])
  })

  it("will not move a log an owner update still uses", async () => {
    sqlite.exec(`
      INSERT INTO daily_logs (id,project_id,log_date,work_completed,created_at,updated_at) VALUES ('log','job','2026-10-20','Old','${STAMP}','${STAMP}');
      INSERT INTO owner_project_updates (id,project_id,title,update_date,summary,source_daily_log_ids,created_at,updated_at) VALUES ('update','job','October update','2026-10-21','','["log"]','${STAMP}','${STAMP}');
    `)
    expect(await updateProjectDailyLog("job", { ...logInput, dailyLogId: "log", targetProjectId: "peer" })).toEqual({
      success: false,
      error: 'Remove this log and its photos from "October update" before changing projects.',
    })
    expect(rows("SELECT project_id, work_completed FROM daily_logs")).toEqual([{ project_id: "job", work_completed: "Old" }])
    expect(await updateProjectDailyLog("job", { ...logInput, dailyLogId: "missing", targetProjectId: "job" })).toEqual({
      success: false,
      error: "Daily log not found.",
    })
  })

  it("reviews a log", async () => {
    sqlite.exec(`INSERT INTO daily_logs (id,project_id,log_date,work_completed,created_at,updated_at) VALUES ('log','job','2026-10-20','Old','${STAMP}','${STAMP}');`)
    expect(await updateDailyLogReview("job", { dailyLogId: "log", reviewStatus: "bogus", isClientVisible: true })).toEqual({ success: true })
    expect(rows("SELECT review_status, is_client_visible FROM daily_logs")).toEqual([{ review_status: "needs_review", is_client_visible: 1 }])
    expect(await updateDailyLogReview("job", { dailyLogId: " ", reviewStatus: "approved", isClientVisible: true })).toEqual({
      success: false,
      error: "Daily log is required.",
    })
  })

  it("deletes logs and keeps their files", async () => {
    sqlite.exec(`
      INSERT INTO daily_logs (id,project_id,author_id,log_date,work_completed,created_at,updated_at) VALUES ('log','job','staff','2026-10-20','Old','${STAMP}','${STAMP}');
      INSERT INTO daily_log_photos (id,project_id,daily_log_id,file_name,created_at,updated_at) VALUES ('photo','job','log','a.jpg','${STAMP}','${STAMP}');
    `)
    expect(await deleteProjectDailyLogs("job", ["log", " log "])).toEqual({ success: true, deletedCount: 1 })
    expect(rows("SELECT COUNT(*) AS n FROM daily_logs")).toEqual([{ n: 0 }])
    expect(rows("SELECT daily_log_id FROM daily_log_photos")).toEqual([{ daily_log_id: null }])
    expect(mocks.recordActivityEvent).toHaveBeenCalledTimes(1)
  })
})
