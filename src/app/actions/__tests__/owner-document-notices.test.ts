import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  notificationPreferences,
  organizationMembers,
  projectBudgetApplications,
  projectContacts,
  projectContractDeposits,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import { ownerNoticeDate } from "@/lib/billing/owner-document-notices"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  recordActivityEvent: vi.fn(),
  createNotificationEvent: vi.fn(),
  sendCompassEmail: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent, activityActorName: () => "Cassandra" }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, COMPASS_APP_URL: "https://compass.example.com/" } })) }))
vi.mock("@/lib/notifications/create-event", () => ({ createNotificationEvent: mocks.createNotificationEvent }))
vi.mock("@/lib/email/compass-email", () => ({ sendCompassEmail: mocks.sendCompassEmail }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  getOwnerDocumentEmailDraft,
  getOwnerDocumentNotificationRecipients,
  sendOwnerDocumentNotification,
} from "@/app/actions/owner-document-notices"

let sqlite: InstanceType<typeof Database>

// Columns stay nullable so fixtures only fill what these actions read.
function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function insert(table: string, row: Readonly<Record<string, string | number | null>>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row))
}

function person(id: string, email: string, name: string, orgRole: string, projectRole: string | null): void {
  insert("users", { id, email, display_name: name, is_active: 1 })
  insert("organization_members", { id: `m-${id}`, organization_id: "org", user_id: id, role: orgRole })
  if (projectRole) insert("project_members", { id: `p-${id}`, project_id: "bishop", user_id: id, role: projectRole })
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of [projects, projectBudgetApplications, projectContractDeposits, projectContacts, projectMembers, users, organizationMembers, notificationPreferences]) createTable(table)
  insert("projects", { id: "bishop", name: "Ezell Residence", project_number: "H-430-1900", organization_id: "org" })
  insert("project_budget_applications", { id: "app-1", project_id: "bishop", source_system: "compass_contract_budget", application_number: "1", status: "billed", owner_visible: 1, current_payment_due: 163_610.98 })
  insert("project_contacts", { id: "c-ryan", project_id: "bishop", contact_type: "owner", display_name: "Ryan", email: "Ryan@BishopBuilt.example", active: 1 })
  insert("project_contacts", { id: "c-sub", project_id: "bishop", contact_type: "subcontractor", display_name: "Framer", email: "framer@example.com", active: 1 })
  person("ryan", "ryan@bishopbuilt.example", "Ryan Bishop", "client", "owner")
  person("pat", "pat@bishopbuilt.example", "Pat Bishop", "client", "client")
  person("framer", "framer@example.com", "Framer", "subcontractor", "subcontractor")
  person("staff", "cassandra@example.com", "Cassandra", "admin", null)
  const db = drizzle(sqlite)
  mocks.getDb.mockReturnValue(db)
  mocks.requireAuth.mockResolvedValue({ id: "staff", role: "admin", organizationId: "org", email: "cassandra@example.com", displayName: "Cassandra" })
  mocks.sendCompassEmail.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "m", error: null })
})
afterEach(() => sqlite.close())

describe("Create email", () => {
  it("starts a project email to the owner with the pay application wording and PDF", async () => {
    const result = await getOwnerDocumentEmailDraft("bishop", "pay-application", "app-1")
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.to).toEqual(["ryan@bishopbuilt.example", "pat@bishopbuilt.example"])
    expect(result.data.subject).toBe("Pay Application #1 - Ezell Residence (H-430-1900)")
    expect(result.data.body).toContain("The amount due this period is $163,610.98.")
    expect(result.data.body).toContain("https://compass.example.com/preview/projects/bishop/owner/budget")
    expect(result.data.body).toContain("Cassandra")
    expect(result.data.attachment).toEqual({ url: "/api/projects/bishop/pay-applications/app-1/pdf", fileName: "H-430-1900-PayApp-01.pdf" })
  })

  it("waits until the pay application is approved for billing", async () => {
    sqlite.prepare("UPDATE project_budget_applications SET status = 'internal_review', owner_visible = 0").run()
    expect((await getOwnerDocumentEmailDraft("bishop", "pay-application", "app-1")).success).toBe(false)
  })

  it("words an open deposit request with its number and due date", async () => {
    insert("project_contract_deposits", { id: "dep", project_id: "bishop", source_system: "compass", status: "requested", requested_amount_cents: 25_000_00, requested_at: "2026-10-19", due_date: "2026-11-01", created_at: "1" })
    const result = await getOwnerDocumentEmailDraft("bishop", "deposit-request", "dep")
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.subject).toBe("Deposit Request H-430-1900-DEP-1 - Ezell Residence (H-430-1900)")
    expect(result.data.body).toContain("We're requesting a deposit of $25,000.00 for Ezell Residence, due November 1, 2026.")
    expect(result.data.attachment?.url).toContain("/api/projects/bishop/print/deposit-request")
    expect(result.data.attachment?.fileName).toBe("H-430-1900-DEP-1.pdf")
  })

  it("refuses clients", async () => {
    mocks.requireAuth.mockResolvedValue({ id: "ryan", role: "client", organizationId: "org", email: "ryan@bishopbuilt.example", displayName: "Ryan" })
    expect((await getOwnerDocumentEmailDraft("bishop", "pay-application", "app-1")).success).toBe(false)
  })
})

describe("Send notification", () => {
  it("lists only the owner's portal users", async () => {
    const result = await getOwnerDocumentNotificationRecipients("bishop", "pay-application", "app-1")
    expect(result).toEqual({ success: true, data: [{ name: "Ryan Bishop", email: "ryan@bishopbuilt.example" }, { name: "Pat Bishop", email: "pat@bishopbuilt.example" }] })
  })

  it("notifies owner users in Compass and emails each one who allows email", async () => {
    insert("notification_preferences", { user_id: "pat", email_enabled: 0 })
    const result = await sendOwnerDocumentNotification("bishop", "pay-application", "app-1")
    expect(result).toEqual({ success: true, notified: 2, emailed: 1 })
    expect(mocks.createNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "billing.pay_application",
      audience: "owner",
      href: "/preview/projects/bishop/owner/budget",
      recipients: [{ userId: "ryan", email: "ryan@bishopbuilt.example" }, { userId: "pat", email: "pat@bishopbuilt.example" }],
      delivery: { inApp: true, email: false, push: true },
    }))
    expect(mocks.sendCompassEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendCompassEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["ryan@bishopbuilt.example"], subject: "Pay Application #1 - Ezell Residence (H-430-1900)" }))
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_application_owner_notified" }))
  })

  it("points to Create email when no owner has Compass access", async () => {
    sqlite.prepare("DELETE FROM project_members WHERE role IN ('owner', 'client')").run()
    const result = await sendOwnerDocumentNotification("bishop", "pay-application", "app-1")
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("Create email")
    expect(mocks.createNotificationEvent).not.toHaveBeenCalled()
    expect(mocks.sendCompassEmail).not.toHaveBeenCalled()
  })
})

describe("owner notice dates", () => {
  it("writes the calendar date without shifting time zones", () => {
    expect(ownerNoticeDate("2026-11-01")).toBe("November 1, 2026")
    expect(ownerNoticeDate("soon")).toBeNull()
    expect(ownerNoticeDate(null)).toBeNull()
  })
})
