import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getProjectAccessRecord: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn() }))
vi.mock("@/lib/project-access", () => ({ getProjectAccessRecord: mocks.getProjectAccessRecord }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  clearProjectTravelOverride,
  getProjectTravelCharge,
  saveProjectTravelOverride,
} from "../project-travel-charges"
import { EMPTY_TRAVEL_OVERRIDE } from "@/lib/portfolio-map/travel-overrides"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

function open(role = "admin"): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  for (const column of ["address TEXT", "public_location_city TEXT", "site_latitude REAL", "site_longitude REAL", "site_elevation_ft INTEGER", "site_location_address TEXT", "site_location_status TEXT", "site_located_at TEXT"]) {
    opened.sqlite.exec(`ALTER TABLE projects ADD COLUMN ${column}`)
  }
  opened.sqlite.exec(`
    CREATE TABLE travel_charge_settings (organization_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
    CREATE TABLE project_profile_audit_events (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, actor_user_id TEXT, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL);
    UPDATE projects SET address = '100 Main St, Leadville, CO 80461' WHERE id = 'project-a';
  `)
  opened.sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0194_project_travel_charge_overrides.sql"), "utf8").replaceAll("--> statement-breakpoint", ""))
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.requireAuth.mockResolvedValue({ id: "staff-a", role, organizationId: "org-a", isActive: true })
  mocks.getProjectAccessRecord.mockResolvedValue({ organizationId: "org-a" })
  return opened
}

function count(db: CorrespondenceTestDatabase, sql: string): number {
  const row = db.sqlite.prepare(sql).get()
  return typeof row === "object" && row !== null && "n" in row && typeof row.n === "number" ? row.n : -1
}

describe("per-job zone charges", () => {
  it("saves adjustments, applies them, and audits each change", async () => {
    database = open()
    const result = await saveProjectTravelOverride("project-a", {
      ...EMPTY_TRAVEL_OVERRIDE,
      siteElevationFt: 10350,
      lodging: "yes",
      lodgingPerNightCents: 16000,
      note: "Crew stays in Leadville",
    })
    expect(result).toEqual({ success: true })
    const view = await getProjectTravelCharge("project-a")
    expect(view?.override.siteElevationFt).toBe(10350)
    expect(view?.effective?.mountainBand).toBe(2)
    expect(view?.effective?.lodgingAndPerDiem).toBe(true)
    expect(view?.effective?.lodgingPerNightCents).toBe(16000)
    expect(view?.effective?.custom).toEqual(["elevation", "lodging", "lodgingRate"])
    expect(view?.defaults?.custom).toEqual([])
    expect(count(database, "SELECT count(*) AS n FROM project_profile_audit_events WHERE event_type = 'project_travel_charges_updated'")).toBe(1)
  })

  it("removes the row when cleared and records it", async () => {
    database = open()
    await saveProjectTravelOverride("project-a", { ...EMPTY_TRAVEL_OVERRIDE, lodging: "no" })
    expect(await clearProjectTravelOverride("project-a")).toEqual({ success: true })
    expect(count(database, "SELECT count(*) AS n FROM project_travel_charge_overrides")).toBe(0)
    expect(count(database, "SELECT count(*) AS n FROM project_profile_audit_events WHERE event_type = 'project_travel_charges_cleared'")).toBe(1)
  })

  it("refuses roles that cannot edit zone charges and zones that do not exist", async () => {
    database = open("field_staff")
    const denied = await saveProjectTravelOverride("project-a", { ...EMPTY_TRAVEL_OVERRIDE, lodging: "yes" })
    expect(denied.success).toBe(false)
    database.close()
    database = open()
    const badZone = await saveProjectTravelOverride("project-a", { ...EMPTY_TRAVEL_OVERRIDE, zoneIndex: 7 })
    expect(badZone).toEqual({ success: false, error: "Choose one of the current zones." })
  })
})
