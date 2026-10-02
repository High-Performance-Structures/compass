import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  assertProjectAccess: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/lib/permissions", () => ({
  requirePermission: mocks.requirePermission,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))

import { duplicateProjectEstimate } from "@/app/actions/project-estimates"

const user = {
  id: "user-1",
  role: "admin",
  organizationId: "org-1",
  organizationType: "internal",
}

const source = {
  id: "estimate-1",
  projectId: "source-project",
  estimateNumber: "SOURCE-00",
  versionNumber: 2,
  status: "draft",
  clientName: "Source client",
  clientMailingAddress: "Source address",
  clientSignerContactId: "source-contact",
  clientSignerName: "Source signer",
  clientSignerTitle: "Owner",
  clientSignerEmail: "source@example.com",
  clientSignersJson: "[]",
  showAssemblyBuilderFee: true,
  showCostBreakdowns: true,
  companySignerContactId: null,
  companySignerName: null,
  companySignerTitle: null,
  companySignerEmail: null,
  companySignerInitials: null,
  sourceWorkbookId: "source-workbook",
  sourceWorkbookUrl: "https://example.com/source",
  templateVersionId: "source-template",
  templateApplicationId: "source-application",
  termsTemplateId: "source-terms",
  introductionTemplateId: null,
  closingTemplateId: null,
  foxitEnvelopeId: "old-envelope",
  sageRecordId: "old-sage-record",
}

function configureDb(
  changingPhase: boolean,
  latestVersion: number,
  targetPhase: { readonly familyId: string; readonly projectId: string | null } = {
    familyId: "family-1",
    projectId: "destination-project",
  }
): {
  readonly batch: ReturnType<typeof vi.fn>
  readonly inserted: ReturnType<typeof vi.fn>
} {
  const reportPhases = [{
    id: "report-phase-1",
    divisionCode: "01",
    name: "Foundation",
    description: null,
    itemize: false,
    sortOrder: 0,
  }]
  const assemblies = [{ id: "assembly-1", name: "Foundation package", description: "Across divisions", sortOrder: 0 }]
  const rows: readonly (readonly unknown[])[] = changingPhase
    ? [
        [{ name: "Source", organizationId: "org-1", clientName: "Source client", mailingAddress: "Source address" }],
        [source],
        [{ familyId: "family-1" }],
        [targetPhase],
        [{ name: "Destination", organizationId: "org-1", clientName: "Destination client", mailingAddress: "Destination address" }],
        latestVersion ? [{ versionNumber: latestVersion }] : [],
        [{ id: "destination-contact", contactType: "owner", displayName: "Destination signer", role: "Owner", email: "destination@example.com" }],
        reportPhases,
        assemblies,
      ]
    : [
        [{ name: "Source", organizationId: "org-1", clientName: "Source client", mailingAddress: "Source address" }],
        [source],
        [{ versionNumber: latestVersion }],
        reportPhases,
        assemblies,
      ]
  let selectIndex = 0
  const select = vi.fn(() => {
    const selectedRows = rows[selectIndex] ?? []
    selectIndex += 1
    const selectingContacts = changingPhase && selectIndex === 7
    const selectingReportPhases = selectIndex === (changingPhase ? 8 : 4)
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    }
    query.from.mockReturnValue(query)
    const selectingAssemblies = selectIndex === (changingPhase ? 9 : 5)
    if (selectingReportPhases || selectingAssemblies) {
      query.where.mockResolvedValue(selectedRows)
    } else {
      query.where.mockReturnValue(query)
    }
    if (selectingContacts) {
      query.orderBy.mockResolvedValue(selectedRows)
    } else {
      query.orderBy.mockReturnValue(query)
    }
    query.limit.mockResolvedValue(selectedRows)
    return query
  })
  const inserted = vi.fn()
  const batch = vi.fn().mockImplementation(async (statements: readonly unknown[]) =>
    statements.map(() => ({ success: true }))
  )
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: readonly unknown[]) => ({ sql, params })),
    })),
    batch,
  }
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: rawDb } })
  mocks.getDb.mockReturnValue({
    select,
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        inserted(value)
        return { toSQL: () => ({ sql: "INSERT HEADER", params: [] }) }
      }),
    })),
  })
  return { batch, inserted }
}

describe("duplicateProjectEstimate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue(user)
    mocks.assertProjectAccess.mockImplementation(async (_db: unknown, _user: unknown, projectId: string) => ({
      projectNumber: projectId === "source-project" ? "SOURCE" : "DEST",
    }))
  })

  it("copies to another activated phase and clears source phase links", async () => {
    const db = configureDb(true, 3)

    const result = await duplicateProjectEstimate("source-project", source.id, {
      destinationPhaseId: "phase-2",
      versionNumber: 5,
    })

    if (!result.success) throw new Error(result.error)
    expect(mocks.assertProjectAccess).toHaveBeenCalledTimes(2)
    expect(db.inserted).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "destination-project",
      estimateNumber: "DEST-00",
      versionNumber: 5,
      status: "draft",
      clientName: "Destination client",
      clientSignerContactId: "destination-contact",
      sourceWorkbookId: null,
      templateApplicationId: null,
      foxitEnvelopeId: null,
      sageRecordId: null,
    }))
    const statements = db.batch.mock.calls[0]?.[0]
    for (const statement of statements ?? []) {
      expect(statement.params).toHaveLength(statement.sql.match(/\?/g)?.length ?? 0)
    }
    expect(statements?.[0]?.params).toEqual(expect.arrayContaining(["destination-project", "DEST-00"]))
    expect(statements?.[2]?.params).toEqual(expect.arrayContaining(["destination-project"]))
    expect(statements?.[3]?.params).toEqual(expect.arrayContaining(["destination-project", "source-project"]))
    expect(statements?.[4]?.params).toEqual(expect.arrayContaining(["destination-project", "report-phase-1"]))
    expect(statements?.find((statement: { readonly sql: string }) => statement.sql.includes("INSERT INTO project_estimate_basis_documents"))?.sql).toContain("NULL")
    expect(statements?.[3]?.sql).toContain("report_phase_id, assembly_id")
    expect(statements?.find((statement: { readonly sql: string }) => statement.sql.includes("SET assembly_id"))?.params).toEqual(expect.arrayContaining(["destination-project", "assembly-1"]))
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/projects/destination-project/estimate")
  })

  it("retains same-phase details when creating the next version", async () => {
    const db = configureDb(false, 2)

    const result = await duplicateProjectEstimate("source-project", source.id)

    expect(result.success).toBe(true)
    expect(db.inserted).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "source-project",
      showAssemblyBuilderFee: true,
  showCostBreakdowns: true,
      estimateNumber: "SOURCE-00",
      versionNumber: 3,
      clientSignerContactId: "source-contact",
      sourceWorkbookId: "source-workbook",
    }))
  })

  it("rejects a version number already used in the destination", async () => {
    const db = configureDb(true, 3)

    const result = await duplicateProjectEstimate("source-project", source.id, {
      destinationPhaseId: "phase-2",
      versionNumber: 3,
    })

    expect(result).toEqual({
      success: false,
      error: "Choose a version number between 4 and 9999.",
    })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("requires access to the destination project before copying", async () => {
    const db = configureDb(true, 0)
    mocks.assertProjectAccess
      .mockResolvedValueOnce({ projectNumber: "SOURCE" })
      .mockRejectedValueOnce(new Error("Project not found"))

    const result = await duplicateProjectEstimate("source-project", source.id, {
      destinationPhaseId: "phase-2",
      versionNumber: null,
    })

    expect(result).toEqual({ success: false, error: "Project not found" })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("rejects a phase from another project family", async () => {
    const db = configureDb(true, 0, {
      familyId: "other-family",
      projectId: "destination-project",
    })

    const result = await duplicateProjectEstimate("source-project", source.id, {
      destinationPhaseId: "unrelated-phase",
      versionNumber: null,
    })

    expect(result).toEqual({
      success: false,
      error: "Choose a phase in this project family.",
    })
    expect(db.batch).not.toHaveBeenCalled()
  })

  it("requires a destination phase to be activated", async () => {
    const db = configureDb(true, 0, {
      familyId: "family-1",
      projectId: null,
    })

    const result = await duplicateProjectEstimate("source-project", source.id, {
      destinationPhaseId: "planned-phase",
      versionNumber: null,
    })

    expect(result).toEqual({
      success: false,
      error: "Activate the destination phase before copying an estimate.",
    })
    expect(db.batch).not.toHaveBeenCalled()
  })
})
