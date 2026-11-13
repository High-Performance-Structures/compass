import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyMigrations } from "@/test/migrated-database"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"

/*
 * The Sage fee writer's result route when Square flagged the payment while
 * the writer held its claim: Sage's record or error is kept on the flagged
 * row, the writer gets a 2xx so its run carries on, and a failure still
 * alerts staff. No Sage or Square is called.
 */

const state: { env: { DB: unknown } } = { env: { DB: null } }
const alerts: unknown[][] = []

vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: state.env }) }))
vi.mock("@/lib/sage/bridge-auth", () => ({
  getSageBridgeSecret: () => "secret",
  readBoundedSageBridgeBody: async (request: Request) => ({ success: true, rawBody: await request.text() }),
  verifySageBridgeRequest: async () => ({ success: true }),
}))
vi.mock("@/lib/sage/square-payment-notifications", () => ({
  notifySageSquareException: async (...args: unknown[]) => {
    alerts.push(args)
  },
}))
vi.mock("@/lib/sage/square-payment", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal()
  return { ...actual, sageSquareWritesEnabled: () => true, hydrateLegacySageSquarePaymentScopes: async () => undefined }
})

const OPERATION = "11111111-1111-4111-8111-111111111111"
const CLAIM = "22222222-2222-4222-8222-222222222222"
const NOW = "2026-11-12T12:00:00.000Z"
let sqlite: InstanceType<typeof Database>
let migratedImage: Buffer | null = null

function migrated(): InstanceType<typeof Database> {
  if (!migratedImage) {
    const image = new Database(":memory:")
    applyMigrations((sql) => image.exec(sql))
    migratedImage = image.serialize()
    image.close()
  }
  return new Database(migratedImage)
}

function post(body: unknown): Request {
  return new Request("https://compass.invalid/api/integrations/sage/square-payments/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  alerts.length = 0
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO sage_square_payment_operations (
      id, organization_id, operation_type, idempotency_key, square_payment_id, square_invoice_id, square_order_id,
      square_location_id, department, sage_invoice_id, sage_invoice_number, amount_cents, deposit_account_number,
      merchant_fee_account_number, payload_json, status, claim_token, error_message, payment_completed_at, requested_at, updated_at
    ) VALUES ('${OPERATION}', 'org-1', 'post_square_processing_fee', 'k1', 'sq-pay', 'sq-inv', 'sq-ord', 'loc', 'Dept', '401',
      'N-1-S01', 300, 10000, 62020, '{}', 'attention', '${CLAIM}', 'Square payment changed or was refunded', '${NOW}', '${NOW}', '${NOW}');
  `)
  state.env = { DB: d1Over(sqlite) }
})
afterEach(() => sqlite.close())

describe("Sage Square results route on a flagged fee", () => {
  it("a failure keeps the writer's error on the row, alerts staff and answers 202", async () => {
    const { POST } = await import("@/app/api/integrations/sage/square-payments/results/route")
    const response = await POST(post({ operationId: OPERATION, claimToken: CLAIM, outcome: "failed", error: "Period closed" }))
    expect(response.status).toBe(202)
    expect(sqlite.prepare("SELECT status, error_message FROM sage_square_payment_operations").get()).toEqual({
      status: "attention",
      error_message: "Square payment changed or was refunded; Sage writer: Period closed",
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.[3]).toBe("Square payment could not be posted to Sage")
  })

  it("a success keeps Sage's record on the row and answers 202; another claim gets 409", async () => {
    const { POST } = await import("@/app/api/integrations/sage/square-payments/results/route")
    const response = await POST(post({ operationId: OPERATION, claimToken: CLAIM, outcome: "succeeded", sageRecordId: "25018", sageRecordNumber: "SQ-1" }))
    expect(response.status).toBe(202)
    expect(sqlite.prepare("SELECT status, sage_record_id FROM sage_square_payment_operations").get()).toEqual({ status: "attention", sage_record_id: "25018" })
    const other = await POST(post({ operationId: OPERATION, claimToken: "33333333-3333-4333-8333-333333333333", outcome: "failed", error: "x" }))
    expect(other.status).toBe(409)
    expect(alerts).toHaveLength(0)
  })
})
