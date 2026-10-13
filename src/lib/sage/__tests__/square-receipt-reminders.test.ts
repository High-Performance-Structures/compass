import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SquareCreatorConfiguration } from "../square-creator-alerts"

const mocks = vi.hoisted(() => ({ settings: vi.fn(), paymentAlertIds: vi.fn() }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: mocks.settings }))
vi.mock("@/lib/sage/square-alert-recipients", () => ({ squareAlertRecipientIds: mocks.paymentAlertIds }))
import {
  pendingSageReceiptChecks, recordSageReceiptCheck, sendSquareReceiptReminders, withinBusinessHours,
} from "../square-receipt-reminders"

type Sqlite = InstanceType<typeof Database>
function sqliteD1(sqlite: Sqlite): unknown {
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
  return { prepare, batch: async (statements: readonly { execute: () => unknown }[]): Promise<unknown> =>
    sqlite.transaction(() => statements.map(statement => statement.execute()))() }
}

const schema = `
  CREATE TABLE organizations (id TEXT PRIMARY KEY, type TEXT, is_active INTEGER);
  CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, is_active INTEGER);
  CREATE TABLE organization_members (organization_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, in_app_enabled INTEGER);
  CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, event_type TEXT,
    source_type TEXT, source_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, audience TEXT, created_at TEXT);
  CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT,
    in_app INTEGER, email INTEGER, sms INTEGER, push INTEGER, created_at TEXT, read_at TEXT, dismissed_at TEXT);
  CREATE TABLE sage_square_payment_operations (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT,
    operation_type TEXT, sage_invoice_id TEXT, sage_invoice_number TEXT, sage_invoice_creator_username TEXT,
    amount_cents INTEGER, payment_completed_at TEXT, status TEXT, sage_record_id TEXT, sage_record_number TEXT,
    claim_token TEXT, completed_at TEXT, updated_at TEXT, sage_receipt_checked_at TEXT, receipt_reminded_at TEXT,
    receipt_reminder_count INTEGER NOT NULL DEFAULT 0);
`
const operationId = "b722d89a-a028-4720-940c-5dd3d7c5c222"
// Tuesday 2026-09-22, 10:00 in Denver.
const tuesdayMorning = new Date("2026-09-22T16:00:00.000Z")
const fixture = `
  INSERT INTO organizations VALUES ('org-1','internal',1);
  INSERT INTO users VALUES ('creator','office',1),('owner','admin',1),('admin2','admin',1);
  INSERT INTO organization_members VALUES ('org-1','creator','office'),('org-1','owner','admin'),('org-1','admin2','admin');
  INSERT INTO sage_square_payment_operations (id,organization_id,project_id,operation_type,sage_invoice_id,sage_invoice_number,
    sage_invoice_creator_username,amount_cents,payment_completed_at,status)
    VALUES ('${operationId}','org-1','project-1','post_square_receipt','100','INV-100','invoice.operator',12345,'2026-09-18T16:00:00.000Z','manual_action_required');
  INSERT INTO notification_events (id, organization_id, event_type, source_type, source_id) VALUES
    ('manual','org-1','sage.square_payment.manual_receipt','sage_square_payment','${operationId}');
  INSERT INTO notification_recipients (id, event_id, user_id) VALUES ('manual:owner','manual','owner');
`
const config: SquareCreatorConfiguration = { organizationId: "org-1", from: "2026-09-01T00:00:00.000Z",
  mappings: new Map([["invoice.operator", "creator"]]) }
const settings = { receiptReminderUserIds: ["owner"], receiptReminderHours: 24,
  receiptReminderBusinessHoursOnly: true, timeZone: "America/Denver" }

describe("Square receipt reminders", () => {
  let sqlite: Sqlite
  let env: CloudflareEnv
  beforeEach(() => {
    sqlite = new Database(":memory:")
    sqlite.exec(schema)
    sqlite.exec(fixture)
    // @ts-expect-error Fixture intentionally omits unrelated runtime bindings.
    env = { DB: sqliteD1(sqlite) }
    mocks.settings.mockResolvedValue(settings)
    mocks.paymentAlertIds.mockResolvedValue(["owner", "admin2"])
  })
  afterEach(() => { sqlite.close(); vi.clearAllMocks() })
  function visible(): unknown {
    return sqlite.prepare(`SELECT e.event_type, r.user_id FROM notification_recipients r JOIN notification_events e ON e.id = r.event_id
      WHERE r.dismissed_at IS NULL ORDER BY e.event_type, r.user_id`).all()
  }

  it("reminds the invoice creator and the chosen people, then repeats only when due", async () => {
    expect(await sendSquareReceiptReminders(env, config, tuesdayMorning)).toBe(1)
    expect(visible()).toEqual([
      { event_type: "sage.square_payment.manual_receipt", user_id: "owner" },
      { event_type: "sage.square_payment.receipt_reminder", user_id: "creator" },
      { event_type: "sage.square_payment.receipt_reminder", user_id: "owner" },
    ])
    expect(sqlite.prepare("SELECT body FROM notification_events WHERE event_type LIKE '%reminder'").get())
      .toEqual({ body: expect.stringContaining("4 days ago") })
    expect(await sendSquareReceiptReminders(env, config, new Date(tuesdayMorning.getTime() + 60 * 60 * 1000))).toBe(0)
    expect(await sendSquareReceiptReminders(env, config, new Date(tuesdayMorning.getTime() + 24 * 60 * 60 * 1000))).toBe(1)
    // Only the newest reminder stays in the bell.
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_recipients WHERE dismissed_at IS NULL AND id LIKE 'square-receipt-reminder%'").get()).toEqual({ n: 2 })
    expect(sqlite.prepare("SELECT receipt_reminder_count AS n FROM sage_square_payment_operations").get()).toEqual({ n: 2 })
  })

  it("falls back to the payment alert people when nobody is chosen for reminders", async () => {
    mocks.settings.mockResolvedValue({ ...settings, receiptReminderUserIds: [] })
    await sendSquareReceiptReminders(env, config, tuesdayMorning)
    expect(sqlite.prepare("SELECT user_id FROM notification_recipients WHERE id LIKE 'square-receipt-reminder%' ORDER BY user_id").all())
      .toEqual([{ user_id: "admin2" }, { user_id: "creator" }, { user_id: "owner" }])
  })

  it("waits for business hours, and can be turned off", async () => {
    expect(await sendSquareReceiptReminders(env, config, new Date("2026-09-26T16:00:00.000Z"))).toBe(0) // Saturday
    expect(await sendSquareReceiptReminders(env, config, new Date("2026-09-22T04:00:00.000Z"))).toBe(0) // 10 PM
    mocks.settings.mockResolvedValue({ ...settings, receiptReminderHours: 0 })
    expect(await sendSquareReceiptReminders(env, config, tuesdayMorning)).toBe(0)
  })

  it("skips people who left or turned off in-app notifications", async () => {
    sqlite.exec("UPDATE users SET is_active=0 WHERE id='creator'; INSERT INTO notification_preferences VALUES ('owner',0)")
    expect(await sendSquareReceiptReminders(env, config, tuesdayMorning)).toBe(0)
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_events WHERE event_type LIKE '%reminder'").get()).toEqual({ n: 0 })
  })

  it("marks a receipt found in Sage as already in Sage and clears its alerts", async () => {
    await sendSquareReceiptReminders(env, config, tuesdayMorning)
    expect(await pendingSageReceiptChecks(env, "org-1")).toEqual([expect.objectContaining({ operationId, amountCents: 12345 })])
    expect(await recordSageReceiptCheck(env, "org-1", { kind: "receipt", operationId, sageInvoiceId: "100", entered: true,
      sageRecordId: "abc", sageRecordNumber: "DD-1", matchReason: "Receipt of $123.45 on 2026-09-19", checkedAt: tuesdayMorning.toISOString() })).toBe(true)
    expect(sqlite.prepare("SELECT status, sage_record_number FROM sage_square_payment_operations").get())
      .toEqual({ status: "already_in_sage", sage_record_number: "DD-1" })
    expect(visible()).toEqual([])
    expect(await pendingSageReceiptChecks(env, "org-1")).toEqual([])
    expect(await sendSquareReceiptReminders(env, config, new Date(tuesdayMorning.getTime() + 48 * 60 * 60 * 1000))).toBe(0)
  })

  it("rechecks a receipt not yet in Sage after ten minutes, and rejects a mismatched invoice", async () => {
    const observation = { kind: "receipt" as const, operationId, sageInvoiceId: "100", entered: false,
      sageRecordId: null, sageRecordNumber: null, matchReason: null, checkedAt: new Date().toISOString() }
    expect(await recordSageReceiptCheck(env, "org-1", observation)).toBe(true)
    expect(await pendingSageReceiptChecks(env, "org-1")).toEqual([])
    expect(await recordSageReceiptCheck(env, "org-1", { ...observation, sageInvoiceId: "999" })).toBe(false)
    expect(await recordSageReceiptCheck(env, "org-2", observation)).toBe(false)
  })

  it("knows business hours in the company's time zone", () => {
    expect(withinBusinessHours(tuesdayMorning, "America/Denver")).toBe(true)
    expect(withinBusinessHours(tuesdayMorning, "Asia/Tokyo")).toBe(false)
  })
})
