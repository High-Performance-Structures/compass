import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { projectSelectionChoices, projectSelectionComments, projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { organizationFeatureSettings } from "@/db/schema"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { eq } from "drizzle-orm"
import {
  context,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "./helpers/correspondence-core"
import {
  projectFinishSelectionRooms,
  projectFinishSelections,
  projectOperations,
  projectChangeOrders,
} from "@/db/schema"
import {
  projectSelectionDecisions as decisions,
  projectSelectionRequests as requests,
  projectSelectionDecisionEvents as events,
} from "@/db/schema-selection-decisions"
import {
  publishSelectionDecision,
  approveSelectionDecision,
  linkSelectionPurchaseOrder,
  unlinkSelectionProcurement,
  type PublishSelectionInput,
} from "@/app/actions/selection-decisions"
import {
  saveSelectionRequest,
  closeSelectionRequest,
} from "@/app/actions/selection-requests"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { moneyCents, safeSelectionUrl } from "@/lib/selections/decisions"

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cloudflare: vi.fn(),
  permission: vi.fn(),
  canFeature: vi.fn(),
  preview: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.permission,
  canFeature: mocks.canFeature,
}))
vi.mock("@/app/actions/project-audience-preview", () => ({
  getProjectAudiencePreview: mocks.preview,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("server-only", () => ({}))
let testDb: CorrespondenceTestDatabase
const date = "2026-09-05T12:00:00.000Z"
const terms: PublishSelectionInput = {
  selectionId: "selection-a",
  expectedRevision: 0,
  selectionUpdatedAt: date,
  published: true,
  decisionDueDate: "2026-10-01",
  allowance: "2500",
  price: "2500",
  scheduleImpact: "Six weeks; no change to completion.",
  ownerNote: "Includes delivery and installation.",
  requiresChangeOrder: false,
  changeOrderId: "",
}
function signIn(id: "staff-a" | "owner-a" | "owner-b" = "staff-a"): void {
  mocks.auth.mockResolvedValue(
    context(testDb, id, id === "owner-b" ? "project-other" : "project-a").user
  )
}
function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  testDb.sqlite.exec(
    `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(",")})`
  )
}
async function publish(
  overrides: Partial<PublishSelectionInput> = {}
): Promise<void> {
  signIn()
  expect(
    await publishSelectionDecision("project-a", { ...terms, ...overrides })
  ).toEqual({ success: true })
}
async function request(): Promise<
  NonNullable<Awaited<ReturnType<typeof currentRequest>>>
> {
  signIn("owner-a")
  expect(
    await saveSelectionRequest("project-a", {
      selectionId: "selection-a",
      revision: 1,
      requestId: null,
      expectedUpdatedAt: null,
      kind: "pricing",
      note: "Please price the brass finish",
      productUrl: "https://example.test/brass",
    })
  ).toEqual({ success: true })
  const row = await currentRequest()
  if (!row) throw Error("Missing request")
  return row
}
async function currentRequest() {
  return testDb.db.select().from(requests).get()
}

beforeEach(async () => {
  testDb = openCorrespondenceTestDatabase()
  for (const table of [
    projectFinishSelections,
    projectOperations,
    projectChangeOrders,
    projectSelectionComments,
    // Status names (Settings › Selections) are read for publish Activity text.
    organizationFeatureSettings,
    // Signed Selection Phases mark "Approved (signed)" and open supplier access.
    projectSelectionRoundSignatures,
    projectSelectionRoundSignatureItems,
    projectSelectionChoices,
    // Selection lists are ordered by the job's room order (room-order.ts).
    projectFinishSelectionRooms,
  ])
    createTable(table)
  testDb.sqlite.exec(
    readFileSync("drizzle/0153_project_selection_decisions.sql", "utf8")
  )
  await testDb.db.insert(projectFinishSelections).values({
    id: "selection-a",
    projectId: "project-a",
    roomName: "Kitchen",
    name: "Faucet",
    category: "Plumbing",
    manufacturer: "Waterworks",
    model: "Henry",
    colorFinish: "Nickel",
    quantity: 1,
    notes: "PRIVATE COST / MARGIN",
    createdAt: date,
    updatedAt: date,
  })
  mocks.cloudflare.mockResolvedValue({ env: { DB: testDb.d1 } })
  mocks.permission.mockResolvedValue(undefined)
  mocks.canFeature.mockResolvedValue(true)
  mocks.preview.mockResolvedValue({ rfqs: [], operations: [] })
  testDb.failures.setBindLimit(100)
  signIn()
})
afterEach(() => {
  testDb.close()
  vi.clearAllMocks()
})

describe("owner selection decisions", () => {
  it("publishes a safe snapshot and records the real owner's revision, terms and signature", async () => {
    await publish()
    signIn("owner-a")
    const workspace = await getSelectionWorkspace("project-a", "owner")
    expect(workspace.canWrite).toBe(true)
    expect(workspace.items).toHaveLength(1)
    expect(JSON.stringify(workspace)).not.toContain("PRIVATE COST")
    expect(workspace.items[0]?.approvalBlocker).toBeNull()
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toEqual({ success: true })
    const approved = await testDb.db.select().from(decisions).get()
    expect(approved).toMatchObject({
      approvedBy: "owner-a",
      approvedByName: "owner-a",
      revision: 1,
    })
    expect(
      (await getSelectionWorkspace("project-a", "owner")).items[0]?.history[0]
    ).toMatchObject({ revision: 1, priceCents: 250000, actorName: "owner-a" })
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    expect(
      await testDb.db
        .select()
        .from(events)
        .where(eq(events.kind, "owner_approved"))
    ).toHaveLength(1)
  })
  it("blocks staff preview writes and foreign-project owners", async () => {
    await publish()
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    signIn("owner-b")
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    await expect(getSelectionWorkspace("project-a", "owner")).rejects.toThrow(
      "Project not found"
    )
  })
  it("hides drafts; read-only staff cannot publish", async () => {
    await publish({ published: false })
    signIn("owner-a")
    expect((await getSelectionWorkspace("project-a", "owner")).items).toEqual(
      []
    )
    signIn()
    mocks.canFeature.mockResolvedValue(false)
    expect((await getSelectionWorkspace("project-a", "staff")).canWrite).toBe(
      false
    )
    mocks.permission.mockRejectedValueOnce(Error("Permission denied"))
    expect(await publishSelectionDecision("project-a", terms)).toMatchObject({
      success: false,
    })
  })
  it("invalidates changed specifications and retains prior approval history when republishing", async () => {
    await publish()
    signIn("owner-a")
    await approveSelectionDecision("project-a", "selection-a", 1)
    await testDb.db
      .update(projectFinishSelections)
      .set({ model: "New model", updatedAt: "changed" })
    expect(
      (await getSelectionWorkspace("project-a", "owner")).items[0]
    ).toMatchObject({ current: false })
    await publish({ expectedRevision: 1, selectionUpdatedAt: "changed" })
    signIn("owner-a")
    const item = (await getSelectionWorkspace("project-a", "owner")).items[0]
    expect(item).toMatchObject({ revision: 2, approvedAt: null, current: true })
    expect(item?.history).toHaveLength(1)
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
  })
  it("checks the draft again atomically at publish time", async () => {
    testDb.failures.setBeforeBatchHook((sqlite) =>
      sqlite.exec(
        "UPDATE project_finish_selections SET updated_at='raced',model='Other'"
      )
    )
    expect(await publishSelectionDecision("project-a", terms)).toMatchObject({
      success: false,
    })
    expect(await testDb.db.select().from(decisions)).toHaveLength(0)
    expect(await testDb.db.select().from(events)).toHaveLength(0)
  })
  it("checks the specification again atomically at approval time", async () => {
    await publish()
    signIn("owner-a")
    testDb.failures.setBeforeBatchHook((sqlite) =>
      sqlite.exec(
        "UPDATE project_finish_selections SET updated_at='raced',model='Other'"
      )
    )
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    expect(
      await testDb.db
        .select()
        .from(events)
        .where(eq(events.kind, "owner_approved"))
    ).toHaveLength(0)
  })
  it("rolls back approval and legacy flags if audit persistence fails", async () => {
    await publish()
    signIn("owner-a")
    testDb.failures.failNextMatching(
      'insert into "project_selection_decision_events"'
    )
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    expect(await testDb.db.select().from(decisions).get()).toMatchObject({
      approvedAt: null,
    })
    expect(
      await testDb.db.select().from(projectFinishSelections).get()
    ).toMatchObject({ ownerApproved: false })
  })
  it("records the owner's choice on a price difference without waiting for the change order (the signature carries it)", async () => {
    await testDb.db.insert(projectChangeOrders).values({
      id: "co-a",
      changeOrderNumber: "CO-1",
      sourceType: "manual",
      scope: "Fixture finish upgrade",
      requesterType: "owner",
      requesterName: "Owner A",
      projectId: "project-a",
      title: "Brass upgrade",
      audience: "owner",
      status: "approved_for_owner",
      createdAt: date,
      updatedAt: date,
    })
    await publish({ price: "2700", changeOrderId: "co-a" })
    signIn("owner-a")
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toEqual({ success: true })
    // The change order is untouched by the click.
    expect(await testDb.db.select({ status: projectChangeOrders.status }).from(projectChangeOrders).get()).toEqual({ status: "approved_for_owner" })
  })
  it("blocks unknown pricing, blank timing, and invalid money", async () => {
    expect(() => moneyCents("-1")).toThrow()
    expect(() => moneyCents("25.001")).toThrow()
    expect(moneyCents("0.29")).toBe(29)
    await publish({ price: "", scheduleImpact: "" })
    signIn("owner-a")
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    expect(() => safeSelectionUrl("javascript:alert(1)")).toThrow()
  })
})

describe("pricing and alternative requests", () => {
  it("supports owner edit and withdrawal with history, then permits approval", async () => {
    await publish()
    const row = await request()
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: false })
    expect(
      await saveSelectionRequest("project-a", {
        selectionId: "selection-a",
        revision: 1,
        requestId: row.id,
        expectedUpdatedAt: row.updatedAt,
        kind: "alternative",
        note: "Consider chrome instead",
        productUrl: "",
      })
    ).toEqual({ success: true })
    const edited = await currentRequest()
    if (!edited) throw Error("Missing")
    expect(
      await closeSelectionRequest(
        "project-a",
        row.id,
        edited.updatedAt,
        "withdraw",
        ""
      )
    ).toEqual({ success: true })
    expect(await currentRequest()).toMatchObject({ status: "withdrawn" })
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toEqual({ success: true })
  })
  it("staff can resolve with a response but cannot withdraw an owner's request", async () => {
    await publish()
    const row = await request()
    signIn()
    expect(
      await closeSelectionRequest(
        "project-a",
        row.id,
        row.updatedAt,
        "withdraw",
        ""
      )
    ).toMatchObject({ success: false })
    expect(
      await closeSelectionRequest(
        "project-a",
        row.id,
        row.updatedAt,
        "resolve",
        ""
      )
    ).toMatchObject({ success: false })
    expect(
      await closeSelectionRequest(
        "project-a",
        row.id,
        row.updatedAt,
        "resolve",
        "Price is now published above."
      )
    ).toEqual({ success: true })
    expect(await currentRequest()).toMatchObject({
      status: "resolved",
      response: "Price is now published above.",
    })
  })
  it("stale updates do not produce phantom audit records even with the same clock", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(date))
    try {
      await publish()
      const row = await request()
      expect(
        await closeSelectionRequest(
          "project-a",
          row.id,
          "stale",
          "withdraw",
          ""
        )
      ).toMatchObject({ success: false })
      expect(
        await testDb.db
          .select()
          .from(events)
          .where(eq(events.kind, "request_withdrawn"))
      ).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// The owner's signature (a signed Selection Phase) approves the selection.
function signed(): void {
  testDb.sqlite.exec("UPDATE project_finish_selections SET status='approved', owner_approved=1")
}

describe("supplier access through procurement", () => {
  it("requires an assigned sub/vendor membership even for project-wide approved specifications", async () => {
    await publish()
    signIn("owner-a")
    await approveSelectionDecision("project-a", "selection-a", 1)
    await expect(getSelectionWorkspace("project-a", "sub_vendor")).rejects.toThrow("Project not found")
    testDb.sqlite.exec("UPDATE project_members SET role='subcontractor' WHERE user_id='owner-a'")
    // The owner's click alone shares nothing with suppliers; the signature does.
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items).toHaveLength(0)
    signed()
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items).toHaveLength(1)
    testDb.sqlite.exec("DELETE FROM project_members WHERE user_id='owner-a'")
    await expect(getSelectionWorkspace("project-a", "sub_vendor")).rejects.toThrow("Project not found")
  })
  it("shares approved selections project-wide while restricting procurement links and owner financial terms", async () => {
    await testDb.db.insert(projectOperations).values({
      id: "po-a",
      projectId: "project-a",
      sourceRecordType: "purchase_order",
      title: "Kitchen fixtures",
      createdAt: date,
      updatedAt: date,
    })
    await publish()
    expect(
      await linkSelectionPurchaseOrder("project-a", "selection-a", "po-a")
    ).toEqual({ success: true })
    signIn("owner-a")
    await approveSelectionDecision("project-a", "selection-a", 1)
    signed()
    // An internal portal preview exercises the same supplier-recipient projection.
    signIn()
    expect(
      (await getSelectionWorkspace("project-a", "sub_vendor")).items
    ).toHaveLength(1)
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items[0]?.links).toEqual([])
    mocks.preview.mockResolvedValue({ rfqs: [], operations: [{ id: "po-a" }] })
    const item = (await getSelectionWorkspace("project-a", "sub_vendor"))
      .items[0]
    expect(item).toMatchObject({
      allowanceCents: null,
      quotedCents: null,
      ownerNote: null,
      approvedByName: null,
      approvedAt: null,
      scheduleImpact: null,
      decisionDueDate: null,
      requests: [],
      history: [],
    })
    expect(item?.links).toHaveLength(1)
    if (!item?.links[0]) throw Error("Missing link")
    expect(
      await unlinkSelectionProcurement("project-a", item.id, item.links[0].id)
    ).toEqual({ success: true })
    expect(
      (await getSelectionWorkspace("project-a", "sub_vendor")).items
    ).toHaveLength(1)
  })
  it("withholds pending, unpublished, and stale approved choices from suppliers", async () => {
    await publish()
    signIn()
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items).toHaveLength(0)
    signIn("owner-a")
    await approveSelectionDecision("project-a", "selection-a", 1)
    signed()
    signIn()
    testDb.sqlite.exec("UPDATE project_selection_decisions SET published=0")
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items).toHaveLength(0)
    testDb.sqlite.exec("UPDATE project_selection_decisions SET published=1")
    testDb.sqlite.exec("UPDATE project_finish_selections SET model='Changed model'")
    expect((await getSelectionWorkspace("project-a", "sub_vendor")).items).toHaveLength(0)
  })

})

describe("RFQ selection integration", () => {
  it("creates the RFQ and source link together and rejects cross-project selection IDs", async () => {
    testDb.sqlite.exec(
      "ALTER TABLE projects ADD COLUMN sage_job_id TEXT; ALTER TABLE projects ADD COLUMN sage_job_number TEXT;"
    )
    const { createRfqRequest } =
      await import("@/app/actions/project-operations")
    const input = {
      title: "Kitchen fixtures",
      vendorCategory: null,
      requestedFrom: "Fixture supplier",
      recipientEmail: null,
      responseDueDate: null,
      priority: "normal",
      scope: null,
      scopeItems: [
        {
          selectionId: "selection-a",
          description: "Kitchen faucet",
          costCode: null,
          phaseCode: null,
          notes: null,
        },
      ],
      documentLinks: [],
    }
    const result = await createRfqRequest("project-a", input)
    expect(result).toMatchObject({ success: true })
    expect(
      testDb.sqlite
        .prepare("SELECT selection_id FROM project_selection_procurement_links")
        .all()
    ).toEqual([{ selection_id: "selection-a" }])
    expect(await createRfqRequest("project-b", input)).toMatchObject({
      success: false,
    })
    testDb.failures.failNextMatching(
      'insert into "project_selection_procurement_links"'
    )
    expect(await createRfqRequest("project-a", input)).toMatchObject({
      success: false,
    })
    expect(await testDb.db.select().from(projectOperations)).toHaveLength(1)
  })
  it("changing staff workflow status does not invent or erase an owner's signature", async () => {
    const { updateProjectSelectionStatus } =
      await import("@/app/actions/project-selections")
    expect(
      await updateProjectSelectionStatus("project-a", "selection-a", "approved")
    ).toMatchObject({ success: true })
    expect(
      await testDb.db.select().from(projectFinishSelections).get()
    ).toMatchObject({ ownerApproved: false, approvedAt: null })
    const row = await testDb.db.select().from(projectFinishSelections).get()
    if (!row) throw Error("Missing")
    await publish({ selectionUpdatedAt: row.updatedAt })
    signIn("owner-a")
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toMatchObject({ success: true })
    signIn()
    expect(
      await updateProjectSelectionStatus("project-a", "selection-a", "ordered")
    ).toMatchObject({ success: true })
    // The owner's click is their recorded choice, not a signature.
    expect(
      await testDb.db.select().from(projectFinishSelections).get()
    ).toMatchObject({
      ownerApproved: false,
      approvedBy: null,
      status: "ordered",
    })
    expect(await testDb.db.select().from(decisions).get()).toMatchObject({
      approvedBy: "owner-a",
    })
  })
})

it("protects published and previously approved choices from deletion, including import reconciliation", async () => {
  const { selectionDeletionAllowed } = await import("@/lib/selections/deletion")
  await publish()
  expect(
    await testDb.db
      .delete(projectFinishSelections)
      .where(selectionDeletionAllowed("selection-a"))
      .returning()
  ).toHaveLength(0)
  signIn("owner-a")
  await approveSelectionDecision("project-a", "selection-a", 1)
  const row = await testDb.db.select().from(projectFinishSelections).get()
  if (!row) throw Error("Missing")
  await publish({
    published: false,
    expectedRevision: 1,
    selectionUpdatedAt: row.updatedAt,
  })
  expect(
    await testDb.db
      .delete(projectFinishSelections)
      .where(selectionDeletionAllowed("selection-a"))
      .returning()
  ).toHaveLength(0)
})

it("allows only the request's owner to edit or withdraw it", async () => {
  await publish()
  const row = await request()
  testDb.sqlite.exec(
    "INSERT INTO project_members VALUES ('other-owner','project-a','owner-b','owner','2026-09-05')"
  )
  signIn("owner-b")
  expect(
    await closeSelectionRequest(
      "project-a",
      row.id,
      row.updatedAt,
      "withdraw",
      ""
    )
  ).toMatchObject({ success: false })
  expect(
    await saveSelectionRequest("project-a", {
      selectionId: "selection-a",
      revision: 1,
      requestId: row.id,
      expectedUpdatedAt: row.updatedAt,
      kind: "pricing",
      note: "Changed by another owner",
      productUrl: "",
    })
  ).toMatchObject({ success: false })
  expect(await currentRequest()).toMatchObject({
    note: row.note,
    status: "open",
  })
})

it.each(["owner_review", "ordered", "installed", "rfq_sent", "deferred"] as const)(
  "the owner's choice is recorded without approving: %s stays",
  async (status) => {
    await publish()
    // Publishing moves needed/proposed on to With owner; set the case's status after it.
    await testDb.db.update(projectFinishSelections).set({ status })
    const before = await testDb.db.select().from(projectFinishSelections).get()
    signIn("owner-a")
    expect(
      await approveSelectionDecision("project-a", "selection-a", 1)
    ).toEqual({ success: true })
    // Only a signed document approves: no status move, no owner approval, no row edit.
    expect(
      await testDb.db.select().from(projectFinishSelections).get()
    ).toMatchObject({ status, ownerApproved: false, approvedAt: null, updatedAt: before?.updatedAt })
    expect(await testDb.db.select().from(decisions).get()).toMatchObject({
      approvedBy: "owner-a",
    })
    expect(
      await testDb.db.select().from(events).where(eq(events.kind, "owner_approved"))
    ).toHaveLength(1)
    // No "Order" to-do until the owner signs.
    expect(
      await testDb.db.select().from(projectOperations).where(eq(projectOperations.sourceRecordId, "selection-a"))
    ).toHaveLength(0)
  }
)

it("a company can turn off the owner's click confirmation; the signed Selection Phase still records the choice", async () => {
  await testDb.db.insert(organizationFeatureSettings).values({
    organizationId: "org-a",
    featureKey: "selections",
    value: JSON.stringify({ ownerChoiceConfirmation: false }),
    updatedAt: date,
  })
  await publish()
  signIn("owner-a")
  expect(await approveSelectionDecision("project-a", "selection-a", 1)).toMatchObject({ success: false, error: expect.stringMatching(/sign the Selection Phase/) })
  expect(await testDb.db.select().from(decisions).get()).toMatchObject({ approvedAt: null })
  expect((await getSelectionWorkspace("project-a", "owner")).ownerChoiceConfirmation).toBe(false)
})

it.each(["withdraw", "resolve"])(
  "retains request history after %s and unpublication",
  async (mode) => {
    await publish()
    const row = await request()
    if (mode === "resolve") signIn()
    const result =
      mode === "resolve"
        ? await closeSelectionRequest(
            "project-a",
            row.id,
            row.updatedAt,
            "resolve",
            "No change needed"
          )
        : await closeSelectionRequest(
            "project-a",
            row.id,
            row.updatedAt,
            "withdraw",
            ""
          )
    expect(result).toEqual({ success: true })
    await publish({ published: false, expectedRevision: 1 })
    const { selectionDeletionAllowed } =
      await import("@/lib/selections/deletion")
    expect(
      await testDb.db
        .delete(projectFinishSelections)
        .where(selectionDeletionAllowed("selection-a"))
        .returning()
    ).toHaveLength(0)
    expect(await testDb.db.select().from(requests)).toHaveLength(1)
  }
)
