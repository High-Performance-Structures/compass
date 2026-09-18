import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { Miniflare } from "miniflare"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createJarvisSignature } from "@/lib/jarvis/auth"
import { isPublicPath } from "@/lib/public-paths"
import {
  pendingSquareInvoiceCreators, recordSquareInvoiceCreator,
  reconcileSquareInvoiceCreatorAlerts, squareCreatorAlertConfiguration,
} from "../square-creator-alerts"

const mocks = vi.hoisted(() => ({ context: vi.fn(), attention: vi.fn(), receipts: vi.fn() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.context }))
vi.mock("@/lib/sage/square-payment", () => ({
  reconcileSageSquareAttentionEvents: mocks.attention,
  reconcileSageSquareManualReceipts: mocks.receipts,
}))
import { GET, POST } from "@/app/api/integrations/sage/square-invoice-creators/route"
import { POST as maintenance } from "@/app/api/operations/sage/square-receipts/route"

type Sqlite = InstanceType<typeof Database>
function sqliteD1(sqlite: Sqlite, beforeBatch: () => void = (): void => {}): unknown {
  function prepare(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    function execute(): Record<string, unknown> {
      if (Reflect.get(statement, "reader") === true) return { success: true, results: statement.all(...values), meta: { changes: 0 } }
      const result = statement.run(...values)
      return { success: true, results: [], meta: { changes: result.changes } }
    }
    return { bind: (...next: unknown[]): unknown => prepare(query, next),
      run: async (): Promise<unknown> => execute(), all: async (): Promise<unknown> => execute(),
      first: async (): Promise<unknown> => statement.get(...values) ?? null, execute }
  }
  return { prepare, batch: async (statements: readonly { execute: () => unknown }[]): Promise<unknown> => {
    beforeBatch()
    return sqlite.transaction(() => statements.map(statement => statement.execute()))()
  } }
}

const schema = `
  CREATE TABLE organizations (id TEXT PRIMARY KEY, type TEXT, is_active INTEGER);
  CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, project_number TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, is_active INTEGER);
  CREATE TABLE organization_members (organization_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, in_app_enabled INTEGER);
  CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, event_type TEXT,
    source_type TEXT, source_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, audience TEXT, created_at TEXT);
  CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT REFERENCES notification_events(id), user_id TEXT REFERENCES users(id),
    in_app INTEGER, email INTEGER, sms INTEGER, push INTEGER, created_at TEXT, read_at TEXT, dismissed_at TEXT);
  CREATE TABLE sage_square_payment_operations (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT,
    operation_type TEXT, square_payment_id TEXT, sage_invoice_id TEXT, sage_invoice_number TEXT, sage_job_short_name TEXT,
    amount_cents INTEGER, currency TEXT, payment_completed_at TEXT, status TEXT, error_message TEXT);
  CREATE TABLE invoices (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, source_system TEXT, source_external_id TEXT, invoice_number TEXT);
  CREATE TABLE payments (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, source_system TEXT, source_external_id TEXT);
  CREATE TABLE invoice_payment_allocations (organization_id TEXT, project_id TEXT, payment_id TEXT, invoice_id TEXT);
`
const operationId = "b722d89a-a028-4720-940c-5dd3d7c5c222"
const observation = { operationId, sageInvoiceId: "100", invoiceNumber: "INV-100", sageJobShortName: "H-100",
  creatorUsername: "Invoice.Operator", checkedAt: "2026-09-18T05:00:00.000Z" }
const fixture = `
  INSERT INTO organizations VALUES ('org-1','internal',1),('org-2','internal',1);
  INSERT INTO projects VALUES ('project-1','org-1','H-100');
  INSERT INTO users VALUES ('employee','office',1),('admin','admin',1),('other','office',1),('external','client',1),('inactive','office',0),('no-finance','unknown_role',1);
  INSERT INTO organization_members VALUES ('org-1','employee','office'),('org-1','admin','admin'),('org-2','other','office'),('org-1','external','client'),('org-1','inactive','office'),('org-1','no-finance','unknown_role');
  INSERT INTO sage_square_payment_operations (id,organization_id,project_id,operation_type,square_payment_id,sage_invoice_id,sage_invoice_number,sage_job_short_name,amount_cents,currency,payment_completed_at,status)
    VALUES ('${operationId}','org-1','project-1','post_square_receipt','payment-100','100','INV-100','H-100',12345,'USD','2026-09-18T04:00:00.000Z','manual_action_required');
  INSERT INTO invoices VALUES ('invoice-100','org-1','project-1','sage','sage-ar-invoice:100','INV-100');
  INSERT INTO payments VALUES ('payment-100','org-1','project-1','sage','square-payment:payment-100');
  INSERT INTO invoice_payment_allocations VALUES ('org-1','project-1','payment-100','invoice-100');
`
const migration = readFileSync("drizzle/0162_square_invoice_creator_alerts.sql", "utf8")

describe("Sage invoice creator payment alerts", () => {
  let sqlite: Sqlite
  let env: { DB: unknown; SAGE_SQUARE_ORGANIZATION_ID: string; SAGE_INVOICE_CREATOR_USER_MAP: string;
    SAGE_SQUARE_CREATOR_ALERTS_FROM: string; JARVIS_BRIDGE_SECRET: string }
  function configuredEnv(): CloudflareEnv {
    // @ts-expect-error Fixture intentionally omits unrelated runtime bindings.
    return env
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(observation.checkedAt)
    sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")
    sqlite.exec(schema)
    sqlite.exec(migration)
    sqlite.exec(fixture)
    env = { DB: sqliteD1(sqlite), SAGE_SQUARE_ORGANIZATION_ID: "org-1",
      SAGE_INVOICE_CREATOR_USER_MAP: JSON.stringify([{ sageUsername: "invoice.operator", userId: "employee" }]),
      SAGE_SQUARE_CREATOR_ALERTS_FROM: "2026-09-18T00:00:00.000Z", JARVIS_BRIDGE_SECRET: "test-report-secret-long-enough" }
    mocks.context.mockResolvedValue({ env })
    mocks.attention.mockResolvedValue({ processed: 0 })
    mocks.receipts.mockResolvedValue({ processed: 0 })
  })
  afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.clearAllMocks() })
  async function report(value: unknown = observation, secret = env.JARVIS_BRIDGE_SECRET): Promise<Response> {
    const body = JSON.stringify(value)
    const target = "/api/integrations/sage/square-invoice-creators"
    const timestamp = String(Math.floor(Date.now() / 1000))
    return POST(new Request(`https://compass.example.test${target}`, { method: "POST", body,
      headers: { "x-compass-timestamp": timestamp,
        "x-compass-signature": await createJarvisSignature(secret, timestamp, "POST", target, body) } }))
  }
  function recipients(): unknown {
    return sqlite.prepare(`SELECT e.event_type, r.user_id, r.in_app, r.email, r.sms, r.push, e.href
      FROM notification_events e JOIN notification_recipients r ON r.event_id = e.id ORDER BY e.event_type`).all()
  }
  it("requires an explicit mapping and cutoff; rejects duplicate normalized usernames", async () => {
    env.SAGE_SQUARE_CREATOR_ALERTS_FROM = ""
    expect(squareCreatorAlertConfiguration(configuredEnv())).toBeNull()
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(0)
    expect((await report()).status).toBe(503)
    env.SAGE_SQUARE_CREATOR_ALERTS_FROM = "2026-09-18T00:00:00Z"
    env.SAGE_INVOICE_CREATOR_USER_MAP = '[{"sageUsername":"X","userId":"employee"},{"sageUsername":"x","userId":"other"}]'
    expect(squareCreatorAlertConfiguration(configuredEnv())).toBeNull()
  })
  it("routes exactly once to the original employee and links project Financials without changing posting", async () => {
    expect(await pendingSquareInvoiceCreators(configuredEnv())).toEqual([{ operationId, sageInvoiceId: "100", invoiceNumber: "INV-100", sageJobShortName: "H-100" }])
    expect((await report()).status).toBe(200)
    expect((await report()).status).toBe(200)
    await reconcileSquareInvoiceCreatorAlerts(configuredEnv())
    expect(recipients()).toEqual([{ event_type: "sage.square_payment.received", user_id: "employee",
      in_app: 1, email: 0, sms: 0, push: 0, href: `/dashboard/projects/project-1/financials?squareReceipt=${operationId}` }])
    expect(sqlite.prepare("SELECT status, amount_cents, invoice_creator_notified_at FROM sage_square_payment_operations").get())
      .toEqual({ status: "manual_action_required", amount_cents: 12345, invoice_creator_notified_at: observation.checkedAt })
    expect(sqlite.prepare("SELECT body FROM notification_events").get()).toEqual({ body: expect.stringContaining("separate accounting step") })
  })
  it.each(["other", "external", "inactive", "no-finance", "unknown"])("never routes financial data to an unauthorized mapped account: %s", async userId => {
    env.SAGE_INVOICE_CREATOR_USER_MAP = JSON.stringify([{ sageUsername: "invoice.operator", userId }])
    await report()
    await reconcileSquareInvoiceCreatorAlerts(configuredEnv())
    expect(recipients()).toEqual([{ event_type: "sage.square_payment.creator_routing", user_id: "admin",
      in_app: 1, email: 0, sms: 0, push: 0, href: `/dashboard/projects/project-1/financials?squareReceipt=${operationId}` }])
  })
  it("respects preferences, retries after correction, and dismisses the routing alert", async () => {
    sqlite.exec("INSERT INTO notification_preferences VALUES ('employee',0)")
    await report()
    expect(recipients()).toEqual([expect.objectContaining({ user_id: "admin" })])
    sqlite.exec("UPDATE notification_preferences SET in_app_enabled=1")
    await reconcileSquareInvoiceCreatorAlerts(configuredEnv())
    expect(recipients()).toHaveLength(2)
    expect(sqlite.prepare("SELECT dismissed_at FROM notification_recipients WHERE user_id='admin'").get())
      .toEqual({ dismissed_at: observation.checkedAt })
  })
  it("keeps unmapped usernames retryable after a protected mapping change", async () => {
    env.SAGE_INVOICE_CREATOR_USER_MAP = "[]"
    await report()
    env.SAGE_INVOICE_CREATOR_USER_MAP = JSON.stringify([{ sageUsername: "invoice.operator", userId: "employee" }])
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(1)
    expect(recipients()).toHaveLength(2)
  })
  it("uses the scoped membership role even when the global role grants broader privileges", async () => {
    sqlite.exec("UPDATE users SET role='admin' WHERE id='employee'; UPDATE organization_members SET role='client' WHERE user_id='employee'")
    await report()
    expect(recipients()).toEqual([expect.objectContaining({ user_id: "admin", event_type: "sage.square_payment.creator_routing" })])
    sqlite.exec("UPDATE users SET role='client' WHERE id='employee'; UPDATE organization_members SET role='office' WHERE user_id='employee'")
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(1)
    expect(recipients()).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: "employee" })]))
  })
  it("does not treat a global admin as an administrator in a client membership", async () => {
    env.SAGE_INVOICE_CREATOR_USER_MAP = "[]"
    sqlite.exec("UPDATE organization_members SET role='client' WHERE user_id='admin'")
    await report()
    expect(recipients()).toEqual([])
    sqlite.exec("UPDATE organization_members SET role='admin' WHERE user_id='admin'")
    await reconcileSquareInvoiceCreatorAlerts(configuredEnv())
    expect(recipients()).toEqual([expect.objectContaining({ user_id: "admin" })])
  })
  it("rechecks a missing Sage creator hourly, without repeated admin alerts", async () => {
    await report({ ...observation, creatorUsername: null })
    expect(await pendingSquareInvoiceCreators(configuredEnv())).toEqual([])
    vi.advanceTimersByTime(3_601_000)
    expect(await pendingSquareInvoiceCreators(configuredEnv())).toHaveLength(1)
    await report({ ...observation, creatorUsername: null, checkedAt: new Date().toISOString() })
    expect(recipients()).toHaveLength(1)
  })
  it.each(["DELETE FROM invoices", "DELETE FROM payments", "DELETE FROM invoice_payment_allocations",
    "UPDATE projects SET organization_id='org-2'", "UPDATE projects SET project_number='H-WRONG'",
    "UPDATE sage_square_payment_operations SET status='attention'",
    "UPDATE sage_square_payment_operations SET payment_completed_at='2020-01-01T00:00:00Z'"])("does not alert on incomplete, conflicted, refunded, or historic data: %s", async query => {
    sqlite.exec(query)
    expect(await pendingSquareInvoiceCreators(configuredEnv())).toEqual([])
    expect((await report()).status).toBe(409)
    expect(recipients()).toEqual([])
  })
  it("rejects unsigned/wrong-key, stale, arbitrary scope, and altered original creator reports", async () => {
    expect((await GET(new Request("https://compass.example.test/api/integrations/sage/square-invoice-creators"))).status).toBe(401)
    expect((await report(observation, "wrong-report-secret-long-enough")).status).toBe(401)
    expect((await report({ ...observation, checkedAt: "2026-09-17T00:00:00Z" })).status).toBe(400)
    expect((await report({ ...observation, organizationId: "org-2" })).status).toBe(400)
    expect((await report({ ...observation, invoiceNumber: "OTHER" })).status).toBe(409)
    await recordSquareInvoiceCreator(configuredEnv(), observation)
    expect((await report({ ...observation, creatorUsername: "Updater" })).status).toBe(409)
    expect(isPublicPath("/api/integrations/sage/square-invoice-creators")).toBe(true)
    expect(isPublicPath("/api/integrations/sage/square-invoice-creators/private")).toBe(false)
  })
  it("atomically rolls back failed recipient delivery and retries on cron", async () => {
    sqlite.exec("CREATE TRIGGER fail_recipient BEFORE INSERT ON notification_recipients BEGIN SELECT RAISE(ABORT,'test failure'); END")
    expect((await report()).status).toBe(503)
    expect(recipients()).toEqual([])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events").get()).toEqual({ count: 0 })
    expect(sqlite.prepare("SELECT invoice_creator_notified_at FROM sage_square_payment_operations").get()).toEqual({ invoice_creator_notified_at: null })
    sqlite.exec("DROP TRIGGER fail_recipient")
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(1)
    expect(recipients()).toHaveLength(1)
  })
  it.each(["Square payment changed or was refunded; review is required", "Square reported invoice.refunded; review is required"])("does not alert an already-posted receipt flagged for review: %s", async error => {
    sqlite.prepare("UPDATE sage_square_payment_operations SET status='succeeded', error_message=?").run(error)
    expect(await pendingSquareInvoiceCreators(configuredEnv())).toEqual([])
    expect((await report()).status).toBe(409)
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(0)
    expect(recipients()).toEqual([])
  })
  it("rechecks refund warnings at the atomic delivery boundary", async () => {
    await recordSquareInvoiceCreator(configuredEnv(), observation)
    env.DB = sqliteD1(sqlite, () => {
      sqlite.exec("UPDATE sage_square_payment_operations SET status='succeeded', error_message='Square reported invoice.refunded; review is required'")
    })
    expect(await reconcileSquareInvoiceCreatorAlerts(configuredEnv())).toBe(0)
    expect(recipients()).toEqual([])
    expect(sqlite.prepare("SELECT invoice_creator_notified_at FROM sage_square_payment_operations").get()).toEqual({ invoice_creator_notified_at: null })
  })
  it("notification failure does not fail existing receipt maintenance", async () => {
    await recordSquareInvoiceCreator(configuredEnv(), observation)
    sqlite.exec("CREATE TRIGGER fail_recipient BEFORE INSERT ON notification_recipients BEGIN SELECT RAISE(ABORT,'test failure'); END")
    const target = "/api/operations/sage/square-receipts"
    const timestamp = String(Math.floor(Date.now() / 1000))
    const response = await maintenance(new Request(`https://compass.example.test${target}`, { method: "POST", body: "{}",
      headers: { "x-compass-timestamp": timestamp, "x-compass-signature": await createJarvisSignature(env.JARVIS_BRIDGE_SECRET, timestamp, "POST", target, "{}") } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ success: true, creatorAlerts: null }))
    expect(mocks.receipts).toHaveBeenCalledOnce()
  })
})

it("executes migration and atomic employee delivery in the actual D1 Worker runtime", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-06-02", script: "export default { fetch() { return new Response('ok') } }", d1Databases: ["DB"] })
  try {
    const db = await runtime.getD1Database("DB")
    // D1 exec accepts newline-separated statements; fixture formatting spans lines.
    for (const statement of [...schema.split(";"), ...migration.split(";"), ...fixture.split(";")]) {
      if (statement.trim()) await db.prepare(statement).run()
    }
    const env = { DB: db, SAGE_SQUARE_ORGANIZATION_ID: "org-1", SAGE_INVOICE_CREATOR_USER_MAP: '[{"sageUsername":"invoice.operator","userId":"employee"}]', SAGE_SQUARE_CREATOR_ALERTS_FROM: "2026-09-18T00:00:00Z" }
    // @ts-expect-error Fixture omits unrelated production bindings.
    const configured: CloudflareEnv = env
    await recordSquareInvoiceCreator(configured, observation)
    expect(await reconcileSquareInvoiceCreatorAlerts(configured)).toBe(1)
    expect(await reconcileSquareInvoiceCreatorAlerts(configured)).toBe(0)
    expect(await db.prepare("SELECT user_id FROM notification_recipients").all()).toEqual(expect.objectContaining({ results: [{ user_id: "employee" }] }))
  } finally { await runtime.dispose() }
}, 30_000)
