import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), requireAuth: vi.fn(), getCloudflareContext: vi.fn(), requirePermission: vi.fn(), assertProjectAccess: vi.fn(), isInternalStaffRole: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/user-roles", () => ({ isInternalStaffRole: mocks.isInternalStaffRole }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { setProjectEstimateClientReportMode } from "@/app/actions/project-estimates"
import { projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"

const user = { id: "user-1", role: "admin", organizationId: "org-1" }
function configureDb(status = "draft", exists = true): { readonly set: ReturnType<typeof vi.fn>; readonly run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue(undefined)
  const where = vi.fn().mockReturnValue({ run })
  const set = vi.fn().mockReturnValue({ where })
  const select = vi.fn(() => {
    let rows: readonly unknown[] = []
    const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn(() => Promise.resolve(rows)) }
    query.from.mockImplementation((table: unknown) => {
      if (table === projects) rows = [{ name: "Project", organizationId: "org-1" }]
      if (table === projectEstimates) rows = exists ? [{ id: "estimate-1", status, foxitStatus: "not_started" }] : []
      return query
    })
    query.where.mockReturnValue(query)
    return query
  })
  mocks.getDb.mockReturnValue({ select, update: () => ({ set }) })
  return { set, run }
}
describe("assembly fee report preference", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAuth.mockResolvedValue(user)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.isInternalStaffRole.mockReturnValue(true)
    mocks.assertProjectAccess.mockResolvedValue({ projectNumber: "O-1" })
  })
  it("saves and disables the preference with the report view and revalidates print", async () => {
    const db = configureDb()
    for (const enabled of [true, false]) {
      expect(await setProjectEstimateClientReportMode("project-1", "estimate-1", "assembly_items", enabled)).toEqual({ success: true, id: "estimate-1" })
      expect(db.set).toHaveBeenLastCalledWith(expect.objectContaining({ clientReportMode: "assembly_items", showAssemblyBuilderFee: enabled }))
    }
    expect(mocks.requirePermission).toHaveBeenCalledWith(user, "budget", "update")
    expect(mocks.assertProjectAccess).toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/print/projects/project-1/estimate")
  })
  it("preserves the preference for existing callers saving only the view", async () => {
    const db = configureDb()
    expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "line_items")).success).toBe(true)
    expect(db.set.mock.calls[0]?.[0].showAssemblyBuilderFee).toBeUndefined()
    expect(db.set.mock.calls[0]?.[0].showCostBreakdowns).toBeUndefined()
  })
  it("saves cost breakdowns with every report view and rejects invalid flags", async () => {
    const db = configureDb()
    for (const mode of ["assembly_items", "assembly_summary", "line_items", "division_summary", "phase_summary"]) {
      for (const enabled of [true, false]) {
        expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", mode, false, enabled)).success).toBe(true)
        expect(db.set).toHaveBeenLastCalledWith(expect.objectContaining({ clientReportMode: mode, showCostBreakdowns: enabled }))
      }
    }
    db.run.mockClear()
    for (const value of ["true", 1, null]) {
      expect(await Reflect.apply(setProjectEstimateClientReportMode, null, ["project-1", "estimate-1", "line_items", false, value])).toEqual({ success: false, error: "Choose whether to show cost breakdowns." })
    }
    expect(db.run).not.toHaveBeenCalled()
  })
  it("blocks locked or missing estimates and invalid report views", async () => {
    for (const status of ["accepted", "signature_pending", "superseded"]) {
      const db = configureDb(status)
      expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "assembly_summary", true)).success).toBe(false)
      expect(db.run).not.toHaveBeenCalled()
    }
    const db = configureDb("draft", false)
    expect((await setProjectEstimateClientReportMode("project-1", "foreign", "assembly_summary", true)).success).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
    configureDb()
    expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "unknown", true)).success).toBe(false)
  })
  it("performs no writes without internal staff permission or project access", async () => {
    const db = configureDb()
    mocks.requirePermission.mockImplementationOnce(() => { throw new Error("Permission denied") })
    expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "assembly_summary", true)).success).toBe(false)
    mocks.assertProjectAccess.mockRejectedValueOnce(new Error("Project access denied"))
    expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "assembly_summary", true)).success).toBe(false)
    mocks.isInternalStaffRole.mockReturnValue(false)
    expect((await setProjectEstimateClientReportMode("project-1", "estimate-1", "assembly_summary", true)).success).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })
})
