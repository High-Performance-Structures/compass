import Database from "better-sqlite3"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/db"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { squarePaymentOperationMachine, squareWebhookEventMachine } from "@/lib/domain/sage-bridge/square-machines"
import {
  beginSquareWebhookEventLease,
  claimSageSquareFeeOperation,
  finishSageSquareFeeOperation,
  finishSquareWebhookEvent,
  flagSageSquareOperationsForAttentionStatement,
  handSageSquareReceiptToStaff,
  insertSageSquareFeeOperation,
  recordResultOnFlaggedSageSquareOperation,
  reopenSquareWebhookEventLease,
} from "@/lib/domain/sage-bridge/square-store"
import type { Db } from "@/lib/server/action-context"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

vi.mock("@/lib/sage/square-alert-recipients", () => ({
  squareAlertRecipientIds: async () => ["admin-1"],
}))

/*
 * Square → Sage (issue #1329, money sweep): the webhook event and payment
 * operation machines, and the store's compare-and-set writes against a
 * database built from every migration, with Square delivering twice, out of
 * order, and the Sage writer reporting late. No Square or Sage is called.
 */

describe("Square machines", () => {
  it("are well formed", () => {
    expect(machineProblems(squareWebhookEventMachine)).toEqual([])
    expect(machineProblems(squarePaymentOperationMachine)).toEqual([])
  })

  it("a posted fee is final; a flagged one waits for a person", () => {
    expect(availableEvents(squarePaymentOperationMachine, "succeeded")).toEqual([])
    expect(availableEvents(squarePaymentOperationMachine, "attention")).toEqual([])
    expect(availableEvents(squarePaymentOperationMachine, "manual_action_required")).toEqual(["found_in_sage", "flag"])
    expect(availableEvents(squareWebhookEventMachine, "processed")).toEqual([])
  })
})

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-12T12:00:00.000Z"
const LATER = "2026-11-12T12:30:00.000Z"
let sqlite: Sqlite
let db: Db
let d1: D1Database
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const image = new Database(":memory:")
    const dir = join(process.cwd(), "drizzle")
    for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      image.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
    }
    migratedImage = image.serialize()
    image.close()
  }
  return new Database(migratedImage)
}

function isD1(value: unknown): value is D1Database {
  return typeof value === "object" && value !== null && "prepare" in value
}

function feeRow(id: string, idempotencyKey: string, amountCents: number) {
  return {
    id, organizationId: null, projectId: null, operationType: "post_square_processing_fee", idempotencyKey,
    squarePaymentId: "sq-pay-1", squareInvoiceId: "sq-inv-1", squareOrderId: "sq-ord-1", squareLocationId: "loc-1",
    department: "Dept", sageJobShortName: "N-1", sageInvoiceId: "401", sageInvoiceNumber: "N-1-S01", amountCents,
    depositAccountNumber: 10000, merchantFeeAccountNumber: 62020, payloadJson: "{}", status: "queued",
    paymentCompletedAt: NOW, now: NOW,
  }
}

function statusOf(id: string): unknown {
  return sqlite.prepare("SELECT status FROM sage_square_payment_operations WHERE id = ?").get(id)
}

beforeEach(() => {
  sqlite = migrated()
  const binding = d1Over(sqlite)
  if (!isD1(binding)) throw new Error("test binding")
  d1 = binding
  db = getDb(binding)
})
afterEach(() => sqlite.close())

describe("Square webhook event lease", () => {
  const event = { eventId: "evt-1", eventType: "invoice.payment_made", squareObjectId: "sq-inv-1", squareCreatedAt: NOW }

  it("a second delivery of the same event is a duplicate while the first holds the lease", async () => {
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: "2026-11-12T11:50:00.000Z", now: NOW })).toEqual({ outcome: "process", attempt: 1 })
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: "2026-11-12T11:50:00.000Z", now: NOW })).toEqual({ outcome: "duplicate" })
  })

  it("a request whose lease ran out can't overwrite the outcome of the one that took over", async () => {
    await beginSquareWebhookEventLease(d1, { ...event, staleBefore: "2026-11-12T11:50:00.000Z", now: NOW })
    // Square retried after the lease ran out.
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: "2026-11-12T12:20:00.000Z", now: LATER })).toEqual({ outcome: "process", attempt: 2 })
    expect(await finishSquareWebhookEvent(d1, { eventId: "evt-1", attempt: 2, event: "complete", errorMessage: null, now: LATER })).toBe(true)
    expect(await finishSquareWebhookEvent(d1, { eventId: "evt-1", attempt: 1, event: "fail", errorMessage: "timeout", now: LATER })).toBe(false)
    expect(sqlite.prepare("SELECT status FROM sage_square_webhook_events").get()).toEqual({ status: "processed" })
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: LATER, now: LATER })).toEqual({ outcome: "duplicate" })
  })

  it("a failed event is retried; a flagged one only by the recovery pass, once", async () => {
    await beginSquareWebhookEventLease(d1, { ...event, staleBefore: NOW, now: NOW })
    await finishSquareWebhookEvent(d1, { eventId: "evt-1", attempt: 1, event: "flag", errorMessage: "no project", now: NOW })
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: LATER, now: LATER })).toEqual({ outcome: "duplicate" })
    expect(await reopenSquareWebhookEventLease(d1, { eventId: "evt-1", retryBefore: LATER, now: LATER })).toBe(2)
    expect(await reopenSquareWebhookEventLease(d1, { eventId: "evt-1", retryBefore: LATER, now: LATER })).toBeNull()
    await finishSquareWebhookEvent(d1, { eventId: "evt-1", attempt: 2, event: "fail", errorMessage: "401", now: LATER })
    expect(await beginSquareWebhookEventLease(d1, { ...event, staleBefore: LATER, now: LATER })).toEqual({ outcome: "process", attempt: 3 })
  })
})

describe("Square processing fee queue", () => {
  it("two deliveries that read different fee totals at once queue the fee once", async () => {
    // Both read 0 cents queued; one saw a $3.00 fee total, the other $3.50.
    expect(await insertSageSquareFeeOperation(d1, { ...feeRow("fee-a", "square-payment:sq-pay-1:fee-total:300", 300), recordedCents: 0 })).toBe(true)
    expect(await insertSageSquareFeeOperation(d1, { ...feeRow("fee-b", "square-payment:sq-pay-1:fee-total:350", 350), recordedCents: 0 })).toBe(false)
    // Re-read: 300 queued, so the $3.50 total adds 50 cents.
    expect(await insertSageSquareFeeOperation(d1, { ...feeRow("fee-b", "square-payment:sq-pay-1:fee-total:350", 50), recordedCents: 300 })).toBe(true)
    expect(sqlite.prepare("SELECT SUM(amount_cents) AS total, COUNT(*) AS n FROM sage_square_payment_operations").get()).toEqual({ total: 350, n: 2 })
  })

  it("the same total delivered twice is one row", async () => {
    expect(await insertSageSquareFeeOperation(d1, { ...feeRow("fee-a", "square-payment:sq-pay-1:fee-total:300", 300), recordedCents: 0 })).toBe(true)
    expect(await insertSageSquareFeeOperation(d1, { ...feeRow("fee-c", "square-payment:sq-pay-1:fee-total:300", 300), recordedCents: 0 })).toBe(true)
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sage_square_payment_operations").get()).toEqual({ n: 1 })
  })
})

describe("Sage fee writer claims and results", () => {
  beforeEach(async () => {
    await insertSageSquareFeeOperation(d1, { ...feeRow("fee-a", "k-300", 300), recordedCents: 0 })
  })

  it("two writer polls claim a fee once", async () => {
    const stale = "2026-11-12T11:50:00.000Z"
    expect(await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t1", staleClaimIso: stale, now: NOW })).toBe(true)
    expect(await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t2", staleClaimIso: stale, now: NOW })).toBe(false)
    // After the claim lease, it can be claimed again (the writer's duplicate scan guards Sage).
    expect(await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t3", staleClaimIso: LATER, now: LATER })).toBe(true)
  })

  it("a late result from a lost claim, or a result sent twice, changes nothing", async () => {
    const result = { operationId: "fee-a", sageRecordId: "25018", sageRecordNumber: "SQ-1", errorMessage: null, now: NOW }
    await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t1", staleClaimIso: NOW, now: NOW })
    await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t2", staleClaimIso: LATER, now: LATER })
    expect(await finishSageSquareFeeOperation(db, { ...result, claimToken: "t1", event: "fail", errorMessage: "late" })).toBe(false)
    expect(await finishSageSquareFeeOperation(db, { ...result, claimToken: "t2", event: "succeed" })).toBe(true)
    expect(await finishSageSquareFeeOperation(db, { ...result, claimToken: "t2", event: "fail", errorMessage: "again" })).toBe(false)
    expect(statusOf("fee-a")).toEqual({ status: "succeeded" })
  })

  it("Square's refund flag wins over a writer result that arrives after it", async () => {
    await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t1", staleClaimIso: NOW, now: NOW })
    await flagSageSquareOperationsForAttentionStatement(d1, { match: "square_payment_id", squareId: "sq-pay-1", errorMessage: "refunded", now: NOW }).run()
    expect(await finishSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t1", event: "succeed", sageRecordId: "1", sageRecordNumber: "1", errorMessage: null, now: NOW })).toBe(false)
    expect(statusOf("fee-a")).toEqual({ status: "attention" })
  })

  it("a result that lost its claim only to Square's flag keeps Sage's record on the flagged row", async () => {
    await claimSageSquareFeeOperation(db, { operationId: "fee-a", claimToken: "t1", staleClaimIso: NOW, now: NOW })
    const record = { operationId: "fee-a", sageRecordId: "25018", sageRecordNumber: "SQ-1", now: NOW }
    // Still running: nothing to record here (the normal path finishes it).
    expect(await recordResultOnFlaggedSageSquareOperation(db, { ...record, claimToken: "t1" })).toBe(false)
    await flagSageSquareOperationsForAttentionStatement(d1, { match: "square_payment_id", squareId: "sq-pay-1", errorMessage: "refunded", now: NOW }).run()
    expect(await recordResultOnFlaggedSageSquareOperation(db, { ...record, claimToken: "other" })).toBe(false)
    expect(await recordResultOnFlaggedSageSquareOperation(db, { ...record, claimToken: "t1" })).toBe(true)
    expect(sqlite.prepare("SELECT status, sage_record_id, sage_record_number FROM sage_square_payment_operations WHERE id = 'fee-a'").get())
      .toEqual({ status: "attention", sage_record_id: "25018", sage_record_number: "SQ-1" })
  })

  it("only older queued receipts are handed to staff", async () => {
    sqlite.exec(`UPDATE sage_square_payment_operations SET operation_type = 'post_square_receipt' WHERE id = 'fee-a'`)
    expect(await handSageSquareReceiptToStaff(db, { operationId: "fee-a", staleClaimIso: NOW, now: NOW })).toBe(true)
    expect(await handSageSquareReceiptToStaff(db, { operationId: "fee-a", staleClaimIso: NOW, now: NOW })).toBe(false)
    expect(statusOf("fee-a")).toEqual({ status: "manual_action_required" })
  })
})

describe("Square alerts", () => {
  it("two deliveries racing on one payment add one alert", async () => {
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, is_active, created_at, updated_at) VALUES ('admin-1', 'admin@example.com', 1, '${NOW}', '${NOW}');
    `)
    const { notifySageSquareManualReceipt } = await import("@/lib/sage/square-payment-notifications")
    const input = {
      organizationId: "org-1", projectId: null, operationId: "op-1", squarePaymentId: "sq-pay-1", sageInvoiceNumber: "N-1-S01",
      department: "Dept", ownerPaymentCents: 10000, depositAccountNumber: 10000, merchantFeeAccountNumber: 62020,
    }
    // Both deliveries read "no alert yet" before either writes; the test binding runs batches one at a time, as D1 does.
    let queue: Promise<unknown> = Promise.resolve()
    const serialized = Object.assign(Object.create(d1), {
      batch: (statements: D1PreparedStatement[]) => {
        const next = queue.then(() => d1.batch(statements))
        queue = next.catch(() => null)
        return next
      },
    })
    const env = { DB: serialized }
    // @ts-expect-error Only DB is read here; projectId is null for an unscoped alert.
    await Promise.all([notifySageSquareManualReceipt(env, input), notifySageSquareManualReceipt(env, input)])
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_events").get()).toEqual({ n: 1 })
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_recipients").get()).toEqual({ n: 1 })
  })
})

// ---------------------------------------------------------------------------
// Guard: Square status writes go through sage-bridge/square-store.ts.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("Square status write guard", () => {
  // Read the tree once, outside the tests' own timeouts (slow under full-suite load).
  let tree: ReadonlyMap<string, string> = new Map()
  beforeAll(() => {
    tree = new Map(sourceFiles("src").map((file) => [file, readFileSync(file, "utf8")]))
  }, 120_000)

  it("only the Square store writes the Square tables", () => {
    const writers = [...tree].filter(([, source]) =>
      /\.(update|insert)\(sageSquare(PaymentOperations|WebhookEvents)\)|(UPDATE|INSERT INTO)\s+sage_square_(payment_operations|webhook_events)/.test(source),
    ).map(([file]) => file)
    expect(writers).toEqual(["src/lib/domain/sage-bridge/square-store.ts"])
  })

  it("no caller passes a status to the plain operation update", () => {
    const offenders = [...tree].filter(([file, source]) =>
      file !== "src/lib/domain/sage-bridge/square-store.ts"
      && /updateSageSquarePaymentOperations\([^)]*\bstatus:/s.test(source),
    ).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it("the store's status writes take their target from the machines", () => {
    const store = readFileSync("src/lib/domain/sage-bridge/square-store.ts", "utf8")
    expect(store).not.toMatch(/status: "(queued|running|succeeded|failed|already_in_sage|manual_action_required|attention)"/)
    expect(store).not.toMatch(/SET status = '(processing|processed|failed|attention)'/)
    expect(store.match(/status: squarePaymentOperationMachine\.transitions[.[]/g)?.length).toBe(3)
  })
})
