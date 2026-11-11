import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerContacts, customers, internalContacts, organizationMembers, projectChangeOrderHistory, projectChangeOrderLines, projectChangeOrders, projectContacts, projects, users, vendorContacts, vendors } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import type { ChangeOrderAcceptanceSettings } from "@/lib/feature-settings/contract-settings"
import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

const rebuild = vi.fn(async () => ({ success: true }))
vi.mock("@/lib/financials/contract-budget-store", () => ({ rebuildProjectContractBudget: rebuild }))
const activity = vi.fn(async () => undefined)
vi.mock("@/lib/activity-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activity-log")>()),
  recordActivityEvent: activity,
}))
let settings: ChangeOrderAcceptanceSettings = { staffSignOff: "approvers", pricedRequiresEvidence: true }
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: async () => settings }))

const { recordChangeOrderManualAcceptance, changeOrderAcceptanceView } = await import(
  "@/lib/domain/estimates/change-order-acceptance"
)

/*
 * Recording an owner's acceptance executes the change order with the
 * acceptance details, a history entry, Activity, and a budget rebuild.
 * Tables are built from the Drizzle definitions without foreign keys; all
 * names and amounts are fictional.
 */

function createTable(table: SQLiteTable): string {
  const config = getTableConfig(table)
  return `CREATE TABLE ${config.name} (${config.columns.map((column) => `${column.name}${column.primary ? " PRIMARY KEY" : ""}`).join(", ")});`
}

const user: AuthUser = {
  id: "user-1",
  email: "staff@example.test",
  firstName: "Sam",
  lastName: "Staff",
  displayName: "Sam Staff",
  avatarUrl: null,
  role: "project_manager",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example Builders",
  organizationType: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}

function setUp(changeOrder: { readonly kind: string | null; readonly amountCents: number | null; readonly status?: string }) {
  const { sqlite, db } = sqliteDb(
    [projectChangeOrders, projectChangeOrderLines, projectChangeOrderHistory, projectContacts, projects, users, customers, customerContacts, vendors, vendorContacts, internalContacts, organizationMembers].map(createTable).join("\n")
  )
  sqlite
    .prepare(
      `INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, amount_cents, status, audience,
        requester_type, requester_name, source_type, budget_treatment, change_order_kind, foxit_status, sage_status, created_at, updated_at)
       VALUES ('co-1', 'proj-1', 'X-1-0001', 'Swap fixture finish', 'scope', ?, ?, 'owner',
        'internal', 'Sam Staff', 'manual', 'additive', ?, 'not_started', 'not_ready', '2026-03-01', '2026-03-01')`
    )
    .run(changeOrder.amountCents, changeOrder.status ?? "approved_for_owner", changeOrder.kind)
  sqlite
    .prepare(
      `INSERT INTO project_contacts (id, project_id, contact_type, display_name, company_name, active)
       VALUES ('contact-1', 'proj-1', 'owner', 'Pat Example', 'Example Household', 1)`
    )
    .run()
  sqlite.prepare(`INSERT INTO projects (id, name, client_name) VALUES ('proj-1', 'Example project', 'Pat Example')`).run()
  sqlite
    .prepare(`INSERT INTO users (id, email, first_name, last_name, display_name, role) VALUES ('user-1', 'staff@example.test', 'Sam', 'Staff', 'Sam Staff', 'project_manager')`)
    .run()
  return { sqlite, db }
}

const signOff = {
  method: "staff_signoff",
  acceptedByContactId: "contact-1",
  acceptedByName: null,
  acceptedOn: "2026-03-09",
  note: "Approved on site during the walkthrough.",
  confirmed: true,
  evidence: null,
} as const

describe("recordChangeOrderManualAcceptance", () => {
  beforeEach(() => {
    settings = { staffSignOff: "approvers", pricedRequiresEvidence: true }
    rebuild.mockClear()
    activity.mockClear()
  })

  it("executes a $0 change order on a staff sign-off and records who accepted it", async () => {
    const { sqlite, db } = setUp({ kind: "description", amountCents: 0 })
    const result = await recordChangeOrderManualAcceptance({
      db, organizationId: "org-1", projectId: "proj-1", changeOrderId: "co-1", user, canApprove: true, acceptance: signOff,
    })
    expect(result).toEqual({ success: true, budgetNote: null })
    expect(
      sqlite
        .prepare(
          `SELECT status, executed_at, acceptance_method, accepted_by_contact_id, accepted_by_name_snapshot, accepted_on,
            acceptance_recorded_by, acceptance_note, executed_document_url FROM project_change_orders`
        )
        .get()
    ).toEqual({
      status: "executed",
      executed_at: "2026-03-09T12:00:00.000Z",
      acceptance_method: "staff_signoff",
      accepted_by_contact_id: "contact-1",
      accepted_by_name_snapshot: "Pat Example",
      accepted_on: "2026-03-09",
      acceptance_recorded_by: "user-1",
      acceptance_note: "Approved on site during the walkthrough.",
      executed_document_url: null,
    })
    expect(sqlite.prepare("SELECT event_type, from_status, to_status FROM project_change_order_history").all()).toEqual([
      { event_type: "acceptance_recorded", from_status: "approved_for_owner", to_status: "executed" },
    ])
    expect(rebuild).toHaveBeenCalledWith({ db, projectId: "proj-1", actorUserId: "user-1" })
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ action: "change_order_acceptance_recorded", entityId: "co-1" }))

    const view = await changeOrderAcceptanceView({
      db,
      row: await db.query.projectChangeOrders.findFirst().then((row) => {
        if (!row) throw new Error("missing row")
        return row
      }),
      user,
      internal: false,
      canApprove: false,
    })
    expect(view.manualAcceptance).toBeNull()
    expect(view.acceptance).toMatchObject({
      method: "staff_signoff",
      note: null,
      summary: "Accepted by Pat Example on Mar 9, 2026 (staff sign-off by Sam Staff)",
    })
  })

  it("refuses a staff sign-off on a priced change order unless the company allows it", async () => {
    const { sqlite, db } = setUp({ kind: null, amountCents: 125_000 })
    sqlite
      .prepare(
        `INSERT INTO project_change_order_lines (id, project_id, change_order_id, line_number, description, cost_code, amount_cents, created_at, updated_at)
         VALUES ('line-1', 'proj-1', 'co-1', 1, 'Fixture', '22 40 00', 125000, '2026-03-01', '2026-03-01')`
      )
      .run()
    const input = { db, organizationId: "org-1", projectId: "proj-1", changeOrderId: "co-1", user, canApprove: true, acceptance: signOff }
    const refused = await recordChangeOrderManualAcceptance(input)
    expect(refused).toMatchObject({ success: false, error: expect.stringMatching(/written approval/) })
    expect(sqlite.prepare("SELECT status FROM project_change_orders").get()).toEqual({ status: "approved_for_owner" })

    settings = { staffSignOff: "approvers", pricedRequiresEvidence: false }
    expect(await recordChangeOrderManualAcceptance(input)).toEqual({ success: true, budgetNote: null })
    expect(sqlite.prepare("SELECT status FROM project_change_orders").get()).toEqual({ status: "executed" })
  })

  it("saves written approval as the executed document", async () => {
    const { sqlite, db } = setUp({ kind: "description", amountCents: 0 })
    const result = await recordChangeOrderManualAcceptance({
      db, organizationId: "org-1", projectId: "proj-1", changeOrderId: "co-1", user, canApprove: true,
      acceptance: {
        ...signOff,
        method: "written_approval",
        acceptedByContactId: null,
        acceptedByName: "Pat Example",
        note: null,
        confirmed: false,
        evidence: { url: "https://drive.google.com/open?id=abc123", label: "Owner approval email.pdf" },
      },
    })
    expect(result.success).toBe(true)
    expect(sqlite.prepare("SELECT status, acceptance_method, executed_document_url, executed_document_label FROM project_change_orders").get()).toEqual({
      status: "executed",
      acceptance_method: "written_approval",
      executed_document_url: "https://drive.google.com/open?id=abc123",
      executed_document_label: "Owner approval email.pdf",
    })
  })

  it("leaves an executed or declined change order and the normal line check alone", async () => {
    const closed = setUp({ kind: "description", amountCents: 0, status: "declined" })
    const declined = await recordChangeOrderManualAcceptance({
      db: closed.db, organizationId: "org-1", projectId: "proj-1", changeOrderId: "co-1", user, canApprove: true, acceptance: signOff,
    })
    expect(declined.success).toBe(false)

    // A $0 change order with recorded lines still needs cost codes, as for the Executed status.
    const legacy = setUp({ kind: null, amountCents: 0 })
    const noLines = await recordChangeOrderManualAcceptance({
      db: legacy.db, organizationId: "org-1", projectId: "proj-1", changeOrderId: "co-1", user, canApprove: true, acceptance: signOff,
    })
    expect(noLines).toEqual({ success: false, error: "Add at least one cost-coded line before execution." })
    expect(rebuild).not.toHaveBeenCalled()
  })
})
