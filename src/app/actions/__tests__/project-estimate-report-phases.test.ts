import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), requireAuth: vi.fn(), getCloudflareContext: vi.fn(), requirePermission: vi.fn(), assertProjectAccess: vi.fn(), isInternalStaffRole: vi.fn(), recordActivityEvent: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/user-roles", () => ({ isInternalStaffRole: mocks.isInternalStaffRole }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { saveProjectEstimateReportPhase, deleteProjectEstimateReportPhase } from "@/app/actions/project-estimate-report-phases"
import { projects } from "@/db/schema"
import { projectEstimates, projectEstimateLines, projectEstimateReportPhases } from "@/db/schema-estimates"

const user = { id: "user-1", role: "admin", organizationId: "org-1" }
const phase = { id: "phase-1", divisionCode: "03", name: "Fox Blocks", description: "ICF walls", itemize: true, sortOrder: 1 }

type Write = { readonly table: unknown; readonly values: unknown; readonly where: ReturnType<typeof vi.fn> }

function configureDb(input: { readonly status?: string; readonly lines?: readonly { readonly id: string; readonly divisionCode: string }[]; readonly phaseExists?: boolean } = {}): { readonly batch: ReturnType<typeof vi.fn>; readonly writes: Write[] } {
  const writes: Write[] = []
  const batch = vi.fn().mockResolvedValue([])
  const select = vi.fn(() => {
    let rows: readonly unknown[] = []
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(() => Promise.resolve(rows)),
      then: (resolveRows: (value: readonly unknown[]) => unknown): unknown => Promise.resolve(rows).then(resolveRows),
    }
    query.from.mockImplementation((table: unknown) => {
      if (table === projectEstimates) rows = [{ status: input.status ?? "draft" }]
      if (table === projects) rows = [{ organizationId: "org-1" }]
      if (table === projectEstimateLines) rows = input.lines ?? [{ id: "forms", divisionCode: "03" }]
      if (table === projectEstimateReportPhases) rows = input.phaseExists === false ? [] : [phase]
      return query
    })
    query.where.mockReturnValue(query)
    return query
  })
  function write(table: unknown, values: unknown): Write {
    const operation = { table, values, where: vi.fn() }
    operation.where.mockReturnValue(operation)
    writes.push(operation)
    return operation
  }
  mocks.getDb.mockReturnValue({ select, batch,
    insert: (table: unknown) => ({ values: (values: unknown) => write(table, values) }),
    update: (table: unknown) => ({ set: (values: unknown) => write(table, values) }),
    delete: (table: unknown) => write(table, null),
  })
  return { batch, writes }
}

describe("custom estimate report phase mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAuth.mockResolvedValue(user)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.isInternalStaffRole.mockReturnValue(true)
    mocks.assertProjectAccess.mockResolvedValue(undefined)
    mocks.recordActivityEvent.mockResolvedValue(undefined)
  })

  it("atomically saves presentation and membership without changing costs or CSI codes", async () => {
    const db = configureDb()
    const result = await saveProjectEstimateReportPhase("project-1", "estimate-1", null, { ...phase, lineIds: ["forms"] })
    expect(result.success).toBe(true)
    expect(mocks.requirePermission).toHaveBeenCalledWith(user, "budget", "update")
    expect(mocks.assertProjectAccess).toHaveBeenCalled()
    expect(db.batch).toHaveBeenCalledOnce()
    expect(db.batch.mock.calls[0]?.[0]).toHaveLength(4)
    const lineWrites = db.writes.filter((write) => write.table === projectEstimateLines)
    expect(lineWrites).toHaveLength(2)
    expect(lineWrites.map((write) => Object.keys(Object(write.values)).sort())).toEqual([ ["reportPhaseId", "updatedAt"], ["reportPhaseId", "updatedAt"] ])
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "estimate_report_phase_created" }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/print/projects/project-1/estimate")
  })

  it("chunks large phase membership without imposing a line or dollar cap", async () => {
    const lines = Array.from({ length: 201 }, (_, index) => ({ id: `line-${index}`, divisionCode: "03" }))
    const db = configureDb({ lines })
    const result = await saveProjectEstimateReportPhase("project-1", "estimate-1", phase.id, { ...phase, lineIds: lines.map((line) => line.id) })
    expect(result.success).toBe(true)
    expect(db.batch.mock.calls[0]?.[0]).toHaveLength(6)
    expect(db.writes.filter((write) => write.table === projectEstimateLines)).toHaveLength(4)
  })

  it("requires delete permission and deletes only the phase, returning its lines to CSI", async () => {
    const db = configureDb()
    const result = await deleteProjectEstimateReportPhase("project-1", "estimate-1", phase.id)
    expect(result).toEqual({ success: true, id: phase.id })
    expect(mocks.requirePermission).toHaveBeenCalledWith(user, "budget", "delete")
    expect(db.writes.filter((write) => write.values === null).map((write) => write.table)).toEqual([projectEstimateReportPhases])
    expect(db.writes.find((write) => write.table === projectEstimateLines)?.values).toMatchObject({ reportPhaseId: null })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "estimate_report_phase_deleted", metadata: expect.objectContaining({ name: "Fox Blocks", description: "ICF walls" }) }))
  })

  it("blocks locked estimates and external staff", async () => {
    for (const status of ["signature_pending", "accepted", "superseded"]) {
      const db = configureDb({ status })
      expect((await saveProjectEstimateReportPhase("project-1", "estimate-1", null, { ...phase, lineIds: [] })).success).toBe(false)
      expect(db.batch).not.toHaveBeenCalled()
    }
    const db = configureDb()
    mocks.isInternalStaffRole.mockReturnValue(false)
    expect((await deleteProjectEstimateReportPhase("project-1", "estimate-1", phase.id)).success).toBe(false)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("rejects foreign phase IDs and cross-division membership", async () => {
    const db = configureDb({ phaseExists: false, lines: [{ id: "steel", divisionCode: "05" }] })
    for (const lineIds of [[], ["steel"], ["foreign"]]) {
      expect((await saveProjectEstimateReportPhase("project-1", "estimate-1", phase.id, { ...phase, lineIds })).success).toBe(false)
    }
    expect((await deleteProjectEstimateReportPhase("project-1", "estimate-1", "foreign-phase")).success).toBe(false)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("performs no writes when permission or project access is denied", async () => {
    const db = configureDb()
    mocks.requirePermission.mockImplementationOnce(() => { throw new Error("Permission denied") })
    expect((await saveProjectEstimateReportPhase("project-1", "estimate-1", null, { ...phase, lineIds: [] })).success).toBe(false)
    mocks.assertProjectAccess.mockRejectedValueOnce(new Error("Project access denied"))
    expect((await deleteProjectEstimateReportPhase("project-1", "estimate-1", phase.id)).success).toBe(false)
    expect(db.batch).not.toHaveBeenCalled()
  })
})
