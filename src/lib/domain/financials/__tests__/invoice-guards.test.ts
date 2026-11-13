import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { sql } from "drizzle-orm"

import { getDb } from "@/db"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { readInvoiceIdsSetByPayments } from "@/lib/domain/financials/receivables"
import { deriveBillTotals, legacyInvoiceEdit } from "@/lib/domain/financials/rules"
import { EMAIL_CLAIM_LEASE_MS, invoiceEmailBlock, invoiceEmailBlockMessage } from "@/lib/domain/financials/invoice-email-fence"
import {
  claimSimpleInvoiceEmail,
  completeSimpleInvoiceEmail,
  clearSimpleInvoiceEmailUnconfirmed,
  deleteLegacyInvoiceRow,
  emailDefinitelyNotSent,
  markSimpleInvoiceEmailUnconfirmed,
  releaseSimpleInvoiceEmail,
  renewSimpleInvoiceEmail,
  updateLegacyInvoiceRow,
  type InvoiceEmailClaim,
} from "@/lib/domain/financials/invoice-guards"
import { deleteDraftSimpleInvoiceStatement, reopenSimpleInvoice, reopenSimpleInvoiceStatement, voidSimpleInvoice } from "@/lib/domain/financials/store"
import { cancelSageInvoiceArExportStatement, POSSIBLY_IN_SAGE_SQL } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import type { Db } from "@/lib/server/action-context"

/*
 * Two owner-approved invoice guards (2026-11-12), against a database built
 * from every migration:
 *  1. Older invoices with a recorded payment applied: amount paid and status
 *     can't be changed in the Financials editor; the fence is in the UPDATE.
 *  2. Emailing a simple invoice claims the send first, so a double click or
 *     two staff send it once; a failed send releases the claim.
 */

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-12T12:00:00.000Z"
const LATER = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString()
let sqlite: Sqlite
let db: Db
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

function row(id: string): Record<string, unknown> {
  const found: unknown = sqlite.prepare("SELECT status, amount_paid, amount_due, total, memo, emailed_at, emailed_by_user_id FROM invoices WHERE id = ?").get(id)
  if (typeof found !== "object" || found === null) throw new Error(`no invoice ${id}`)
  return { ...found }
}

function applyPayment(invoiceId: string, cents: number): void {
  sqlite.exec(`
    INSERT INTO payments (id, organization_id, customer_id, project_id, source_system, payment_type, amount, payment_date, created_at, updated_at)
      VALUES ('pay-${invoiceId}', 'org-1', 'c1', 'p1', 'compass', 'received', ${cents / 100}, '2026-11-12', '${NOW}', '${NOW}');
    INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
      VALUES ('alloc-${invoiceId}', 'org-1', 'p1', '${invoiceId}', 'pay-${invoiceId}', ${cents}, '${NOW}');
    UPDATE invoices SET amount_paid = ${cents / 100}, amount_due = total - ${cents / 100}, status = 'partially_paid' WHERE id = '${invoiceId}';
  `)
}

beforeEach(() => {
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES
      ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}'),
      ('org-2', 'Other', 'other', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, created_at, updated_at) VALUES ('u1', 'a@example.com', '${NOW}', '${NOW}'), ('u2', 'b@example.com', '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
    INSERT INTO customers (id, name, organization_id, created_at) VALUES ('c1', 'Owner', 'org-1', '${NOW}');
    INSERT INTO invoices (id, organization_id, customer_id, project_id, source_system, status, issue_date, subtotal, total, amount_due, invoice_kind, invoice_number, created_at, updated_at) VALUES
      ('legacy-paid', 'org-1', 'c1', 'p1', 'buildertrend', 'sent', '2026-11-12', 100, 100, 100, NULL, 'BT-1', '${NOW}', '${NOW}'),
      ('legacy-free', 'org-1', 'c1', 'p1', 'compass', 'sent', '2026-11-12', 100, 100, 100, NULL, 'C-1', '${NOW}', '${NOW}'),
      ('simple-open', 'org-1', 'c1', 'p1', 'compass', 'open', '2026-11-12', 100, 100, 100, 'other', 'P1-INV01', '${NOW}', '${NOW}');
  `)
  const binding = d1Over(sqlite)
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  db = getDb(binding)
})
afterEach(() => sqlite.close())

describe("older invoice editor: amount paid and status set by recorded payments", () => {
  const scope = (id: string) => ({ id, organizationId: "org-1" })

  it("refuses a status or amount paid change once a payment is applied; other fields still save", async () => {
    applyPayment("legacy-paid", 4000)
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { status: "paid", updatedAt: NOW })).toBe("paid_by_payments")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { amountPaid: 100, amountDue: 0, updatedAt: NOW })).toBe("paid_by_payments")
    expect(row("legacy-paid")).toMatchObject({ status: "partially_paid", amount_paid: 40, amount_due: 60 })
    // The editor without those fields: memo and lines save, amount due follows the payments.
    const totals = deriveBillTotals({ lineItems: JSON.stringify([{ description: "Work", quantity: 1, rate: 150, amount: 150 }]) }, { lineItems: null, subtotal: 100, tax: 0, amountPaid: 40 })
    if (!totals.ok || !totals.values) throw new Error("totals")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { ...totals.values, memo: "Changed", updatedAt: NOW })).toBe("updated")
    expect(row("legacy-paid")).toMatchObject({ status: "partially_paid", amount_paid: 40, total: 150, amount_due: 110, memo: "Changed" })
  })

  it("lets the editor re-send the stored status and amount paid unchanged", async () => {
    applyPayment("legacy-paid", 4000)
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { status: "partially_paid", amountPaid: 40, memo: "x", updatedAt: NOW })).toBe("updated")
  })

  it("an invoice with no payments applied behaves as before", async () => {
    expect(await updateLegacyInvoiceRow(db, scope("legacy-free"), { status: "paid", amountPaid: 100, amountDue: 0, updatedAt: NOW })).toBe("updated")
    expect(row("legacy-free")).toMatchObject({ status: "paid", amount_paid: 100, amount_due: 0 })
  })

  it("a released (voided) payment no longer locks the fields", async () => {
    applyPayment("legacy-paid", 4000)
    sqlite.exec(`UPDATE invoice_payment_allocations SET released_at = '${NOW}' WHERE id = 'alloc-legacy-paid'`)
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { status: "sent", updatedAt: NOW })).toBe("updated")
    expect(await readInvoiceIdsSetByPayments(db, "org-1")).toEqual([])
  })

  it("a payment applied after the editor read the invoice still wins (the fence is in the write)", async () => {
    // The editor read the invoice with no payments, then a payment landed before the save.
    applyPayment("legacy-free", 2500)
    expect(await updateLegacyInvoiceRow(db, scope("legacy-free"), { status: "paid", amountPaid: 0, updatedAt: NOW })).toBe("paid_by_payments")
    expect(row("legacy-free")).toMatchObject({ status: "partially_paid", amount_paid: 25 })
  })

  it("refuses a total below the payments applied; a raised total on a paid invoice goes back to partially paid", async () => {
    applyPayment("legacy-paid", 4000)
    const lines = (amount: number) => JSON.stringify([{ description: "Work", quantity: 1, rate: amount, amount }])
    const save = (amount: number) => {
      const totals = deriveBillTotals({ lineItems: lines(amount) }, { lineItems: null, subtotal: 100, tax: 0, amountPaid: 40 })
      if (!totals.ok || !totals.values) throw new Error("totals")
      return updateLegacyInvoiceRow(db, scope("legacy-paid"), { ...totals.values, updatedAt: NOW })
    }
    expect(await save(30)).toBe("total_below_paid")
    expect(row("legacy-paid")).toMatchObject({ total: 100, amount_due: 60, status: "partially_paid" })
    expect(await save(40)).toBe("updated")
    expect(row("legacy-paid")).toMatchObject({ total: 40, amount_paid: 40, amount_due: 0, status: "paid" })
    expect(await save(90)).toBe("updated")
    expect(row("legacy-paid")).toMatchObject({ total: 90, amount_paid: 40, amount_due: 50, status: "partially_paid" })
  })

  it("an invoice with payment history (even a voided payment) can't change job or be deleted; one without can", async () => {
    sqlite.exec(`INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p2', 'Other job', 'org-1', '${NOW}')`)
    applyPayment("legacy-paid", 4000)
    sqlite.exec(`UPDATE invoice_payment_allocations SET released_at = '${NOW}' WHERE id = 'alloc-legacy-paid'`)
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { projectId: "p2", updatedAt: NOW })).toBe("has_payment_history")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { projectId: "p1", memo: "same job", updatedAt: NOW })).toBe("updated")
    expect(await deleteLegacyInvoiceRow(db, scope("legacy-paid"))).toBe("has_payment_history")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-free"), { projectId: "p2", updatedAt: NOW })).toBe("updated")
    expect(await deleteLegacyInvoiceRow(db, { id: "legacy-free", organizationId: "org-1" })).toBe("deleted")
    expect(await deleteLegacyInvoiceRow(db, scope("simple-open"))).toBe("not_found")
  })

  it("the editor's fields only: ids, kind, sync, email and Square state are dropped", () => {
    const edit = legacyInvoiceEdit({ memo: "m", tax: 5, id: "x", invoiceKind: "other", emailedAt: NOW, squareState: "published", sourceSystem: "sage", organizationId: "org-2", total: 1 })
    expect(edit).toEqual({ memo: "m", tax: 5 })
  })

  it("a credit or adjustment invoice with no payments may have a negative total", async () => {
    const totals = deriveBillTotals({ lineItems: JSON.stringify([{ description: "Credit", quantity: 1, rate: -25, amount: -25 }]) }, { lineItems: null, subtotal: 100, tax: 0, amountPaid: 0 })
    if (!totals.ok || !totals.values) throw new Error("totals")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-free"), { ...totals.values, updatedAt: NOW })).toBe("updated")
    expect(row("legacy-free")).toMatchObject({ total: -25, amount_due: -25 })
  })

  it("a new total recomputes amount paid and due from the payments, like the paid-status refresh", async () => {
    // amount_paid drifted from the allocations (e.g. an older import): the new total puts it right.
    applyPayment("legacy-paid", 4000)
    sqlite.exec(`UPDATE invoices SET amount_paid = 12, amount_due = 88 WHERE id = 'legacy-paid'`)
    const totals = deriveBillTotals({ lineItems: JSON.stringify([{ description: "Work", quantity: 1, rate: 120, amount: 120 }]) }, { lineItems: null, subtotal: 100, tax: 0, amountPaid: 12 })
    if (!totals.ok || !totals.values) throw new Error("totals")
    expect(await updateLegacyInvoiceRow(db, scope("legacy-paid"), { ...totals.values, updatedAt: NOW })).toBe("updated")
    expect(row("legacy-paid")).toMatchObject({ total: 120, amount_paid: 40, amount_due: 80, status: "partially_paid" })
  })

  it("lists the locked invoices for the editor, and never touches simple invoices or another company", async () => {
    applyPayment("legacy-paid", 4000)
    expect(await readInvoiceIdsSetByPayments(db, "org-1")).toEqual(["legacy-paid"])
    expect(await readInvoiceIdsSetByPayments(db, "org-2")).toEqual([])
    expect(await updateLegacyInvoiceRow(db, scope("simple-open"), { memo: "x" })).toBe("not_found")
    expect(await updateLegacyInvoiceRow(db, { id: "legacy-free", organizationId: "org-2" }, { memo: "x" })).toBe("not_found")
  })
})

describe("simple invoice email: one send per click window", () => {
  const key = { invoiceId: "simple-open", organizationId: "org-1", projectId: "p1" }
  const windowMs = 2 * 60_000
  const claimAt = async (actorId: string, now: string): Promise<InvoiceEmailClaim | null> => {
    const result = await claimSimpleInvoiceEmail(db, { ...key, actorId, now, windowMs })
    return result.ok ? result.claim : null
  }
  const claimRow = (): Record<string, unknown> => {
    const found: unknown = sqlite.prepare("SELECT email_claimed_at, email_claimed_by, emailed_at FROM invoices WHERE id = 'simple-open'").get()
    if (typeof found !== "object" || found === null) throw new Error("no invoice")
    return { ...found }
  }

  it("defaults to a 2 minute window, a company setting", () => {
    expect(FEATURE_SETTINGS["simple-invoices"].defaults.emailResendWindowMinutes).toBe(2)
  })

  it("two sends at once (double click or two staff): exactly one claims", async () => {
    const claims = await Promise.all([claimAt("u1", NOW), claimAt("u2", NOW)])
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
  })

  it("many concurrent sends still claim once", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => claimAt(index % 2 ? "u1" : "u2", LATER(index))))
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
  })

  it("an in-flight send never shows as emailed and blocks a second send even past the re-send window", async () => {
    expect(await claimAt("u1", NOW)).not.toBeNull()
    expect(claimRow()).toMatchObject({ email_claimed_by: "u1", emailed_at: null })
    expect(await claimSimpleInvoiceEmail(db, { ...key, actorId: "u2", now: LATER(5 * 60_000), windowMs })).toEqual({ ok: false, reason: { kind: "sending" } })
    // A request that died: its lease runs out and the invoice can be sent again.
    expect(await claimAt("u2", LATER(EMAIL_CLAIM_LEASE_MS + 1))).not.toBeNull()
  })

  it("a delivered invoice can't be sent again inside the window, and can after it", async () => {
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    await completeSimpleInvoiceEmail(db, { ...key, claim, now: LATER(5_000) })
    expect(claimRow()).toEqual({ email_claimed_at: null, email_claimed_by: null, emailed_at: LATER(5_000) })
    expect(await claimAt("u2", LATER(60_000))).toBeNull()
    expect(await claimAt("u2", LATER(5_000 + windowMs + 1))).not.toBeNull()
  })

  it("a definitely failed send releases the claim: retry at once, earlier delivery kept", async () => {
    sqlite.exec(`UPDATE invoices SET emailed_at = '2026-11-10T09:00:00.000Z', emailed_by_user_id = 'u2' WHERE id = 'simple-open'`)
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    expect(await claimAt("u2", LATER(1_000))).toBeNull()
    expect(await releaseSimpleInvoiceEmail(db, { ...key, claim })).toBe(true)
    expect(claimRow()).toEqual({ email_claimed_at: null, email_claimed_by: null, emailed_at: "2026-11-10T09:00:00.000Z" })
    expect(await claimAt("u2", LATER(2_000))).not.toBeNull()
  })

  it("only failed, pending_provider and rate_limited count as not sent; unknown keeps the claim", () => {
    for (const status of ["failed", "pending_provider", "rate_limited"]) expect(emailDefinitelyNotSent(status)).toBe(true)
    for (const status of ["unknown", "sent", "queued", ""]) expect(emailDefinitelyNotSent(status)).toBe(false)
  })

  it("a stale release never frees a newer claim", async () => {
    const first = await claimAt("u1", NOW)
    if (!first) throw new Error("claim")
    const second = await claimAt("u2", LATER(EMAIL_CLAIM_LEASE_MS + 1))
    expect(second).not.toBeNull()
    expect(await releaseSimpleInvoiceEmail(db, { ...key, claim: first })).toBe(false)
    await completeSimpleInvoiceEmail(db, { ...key, claim: first, now: LATER(EMAIL_CLAIM_LEASE_MS + 2) })
    expect(claimRow()).toMatchObject({ email_claimed_by: "u2" })
  })

  it("names why a claim was refused: draft, void or missing", async () => {
    sqlite.exec(`INSERT INTO invoices (id, organization_id, customer_id, project_id, source_system, status, issue_date, total, amount_due, invoice_kind, created_at, updated_at)
      VALUES ('simple-draft', 'org-1', 'c1', 'p1', 'compass', 'draft', '2026-11-12', 100, 100, 'other', '${NOW}', '${NOW}')`)
    expect(await claimSimpleInvoiceEmail(db, { ...key, invoiceId: "simple-draft", actorId: "u1", now: NOW, windowMs })).toEqual({ ok: false, reason: { kind: "draft" } })
    expect(await claimSimpleInvoiceEmail(db, { ...key, invoiceId: "nope", actorId: "u1", now: NOW, windowMs })).toEqual({ ok: false, reason: { kind: "missing" } })
    expect(await voidSimpleInvoice(db, { ...key, reason: "Duplicate", actorId: "u1", now: NOW })).toBe(true)
    expect(await claimSimpleInvoiceEmail(db, { ...key, actorId: "u1", now: NOW, windowMs })).toEqual({ ok: false, reason: { kind: "void" } })
  })

  it("reopen and delete are fenced on no delivery and no live claim", async () => {
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    expect(await reopenSimpleInvoice(db, { ...key, now: LATER(1_000) })).toBe(false)
    // A dead send no longer blocks reopen.
    expect(await reopenSimpleInvoice(db, { ...key, now: LATER(EMAIL_CLAIM_LEASE_MS + 1) })).toBe(true)
    sqlite.exec(`UPDATE invoices SET email_claimed_at = '${LATER(EMAIL_CLAIM_LEASE_MS + 2)}', email_claimed_by = 'u1' WHERE id = 'simple-open'`)
    expect(await deleteDraftSimpleInvoiceStatement(db, { ...key, now: LATER(EMAIL_CLAIM_LEASE_MS + 3) })).toEqual([])
    sqlite.exec(`UPDATE invoices SET email_claimed_at = NULL, email_claimed_by = NULL, emailed_at = '${NOW}' WHERE id = 'simple-open'`)
    expect(await deleteDraftSimpleInvoiceStatement(db, { ...key, now: LATER(EMAIL_CLAIM_LEASE_MS + 3) })).toEqual([])
    sqlite.exec(`UPDATE invoices SET emailed_at = NULL WHERE id = 'simple-open'`)
    expect(await deleteDraftSimpleInvoiceStatement(db, { ...key, now: LATER(EMAIL_CLAIM_LEASE_MS + 3) })).toEqual([{ id: "simple-open" }])
  })

  it("names the block: being emailed now, or emailed N minutes ago with the minutes left", () => {
    expect(invoiceEmailBlock({ emailedAt: null, emailClaimedAt: NOW, now: LATER(1_000), windowMs })).toEqual({ kind: "sending" })
    const recent = invoiceEmailBlock({ emailedAt: NOW, emailClaimedAt: null, now: LATER(61_000), windowMs })
    expect(recent).toEqual({ kind: "recently_sent", minutesAgo: 1, minutesLeft: 1 })
    if (!recent) throw new Error("block")
    expect(invoiceEmailBlockMessage(recent)).toBe("This invoice was emailed 1 minute ago. You can send it again in 1 minute.")
    expect(invoiceEmailBlockMessage({ kind: "sending" })).toContain("being emailed right now")
    expect(invoiceEmailBlock({ emailedAt: NOW, emailClaimedAt: null, now: LATER(windowMs + 1), windowMs })).toBeNull()
  })

  it("a refused claim says why: in flight, or recently delivered", async () => {
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    expect(await claimSimpleInvoiceEmail(db, { ...key, actorId: "u2", now: LATER(1_000), windowMs })).toEqual({ ok: false, reason: { kind: "sending" } })
    await completeSimpleInvoiceEmail(db, { ...key, claim, now: LATER(2_000) })
    expect(await claimSimpleInvoiceEmail(db, { ...key, actorId: "u2", now: LATER(62_000), windowMs })).toEqual({ ok: false, reason: { kind: "recently_sent", minutesAgo: 1, minutesLeft: 1 } })
  })

  it("renewing before the hand-off: only the request still holding the claim may send", async () => {
    const first = await claimAt("u1", NOW)
    if (!first) throw new Error("claim")
    const renewed = await renewSimpleInvoiceEmail(db, { ...key, claim: first, now: LATER(60_000) })
    expect(renewed).toEqual({ claimedAt: LATER(60_000), actorId: "u1" })
    // The lease restarts from the renewal.
    expect(await claimAt("u2", LATER(EMAIL_CLAIM_LEASE_MS + 1))).toBeNull()
    // The first request stalled past its lease and another took over: it must not send.
    const second = await claimAt("u2", LATER(60_000 + EMAIL_CLAIM_LEASE_MS + 1))
    expect(second).not.toBeNull()
    expect(await renewSimpleInvoiceEmail(db, { ...key, claim: renewed ?? first, now: LATER(60_000 + EMAIL_CLAIM_LEASE_MS + 2) })).toBeNull()
  })

  it("an unknown outcome blocks reopen and delete until staff confirm it didn't go out; delivery clears it too", async () => {
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    await markSimpleInvoiceEmailUnconfirmed(db, { ...key, now: LATER(1_000) })
    // Long after the lease ran out, reopen is still refused (it may have gone out).
    const muchLater = LATER(EMAIL_CLAIM_LEASE_MS * 10)
    expect(await reopenSimpleInvoice(db, { ...key, now: muchLater })).toBe(false)
    expect(await clearSimpleInvoiceEmailUnconfirmed(db, key)).toBe(true)
    expect(await clearSimpleInvoiceEmailUnconfirmed(db, key)).toBe(false)
    expect(claimRow()).toMatchObject({ email_claimed_at: null, emailed_at: null })
    // Confirmed not sent: it can be sent again at once, and a delivery clears any new mark.
    const again = await claimAt("u2", LATER(2_000))
    if (!again) throw new Error("claim")
    await markSimpleInvoiceEmailUnconfirmed(db, { ...key, now: LATER(3_000) })
    await completeSimpleInvoiceEmail(db, { ...key, claim: again, now: LATER(4_000) })
    const after: unknown = sqlite.prepare("SELECT email_unconfirmed_at FROM invoices WHERE id = 'simple-open'").get()
    expect(after).toEqual({ email_unconfirmed_at: null })
    expect(await reopenSimpleInvoice(db, { ...key, now: muchLater })).toBe(false)
  })

  it("reopen cancels the queued Sage export only when the reopen itself lands, in one batch with the email fence", async () => {
    // The batch reopenProjectInvoice runs (Sage's single-batch reopen plus the email fence).
    const reopenSimpleInvoiceCancellingExport = async (input: typeof key & { readonly now: string }): Promise<boolean> => {
      const [reopened] = await db.batch([
        reopenSimpleInvoiceStatement(db, input, sql`NOT EXISTS (SELECT 1 FROM sage_invoice_ar_exports WHERE invoice_id = ${input.invoiceId} AND ${sql.raw(POSSIBLY_IN_SAGE_SQL)})`),
        cancelSageInvoiceArExportStatement(db, {
          organizationId: input.organizationId, invoiceId: input.invoiceId, now: input.now,
          when: sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${input.invoiceId} AND status = 'draft' AND updated_at = ${input.now})`,
        }),
      ])
      return reopened.length === 1
    }
    const exportRow = (status: string) => sqlite.exec(`DELETE FROM sage_invoice_ar_exports; INSERT INTO sage_invoice_ar_exports (id, organization_id, project_id, invoice_id, status, invoice_number, requested_at, updated_at)
      VALUES ('exp-1', 'org-1', 'p1', 'simple-open', '${status}', 'P1-INV01', '${NOW}', '${NOW}')`)
    const exportStatus = (): unknown => sqlite.prepare("SELECT status FROM sage_invoice_ar_exports WHERE id = 'exp-1'").get()
    // An email in flight: the reopen loses, and the queued export stays queued.
    exportRow("queued")
    const claim = await claimAt("u1", NOW)
    if (!claim) throw new Error("claim")
    expect(await reopenSimpleInvoiceCancellingExport({ ...key, now: LATER(1_000) })).toBe(false)
    expect(exportStatus()).toEqual({ status: "queued" })
    expect(row("simple-open")).toMatchObject({ status: "open" })
    await releaseSimpleInvoiceEmail(db, { ...key, claim })
    // Sage is taking it: no reopen.
    exportRow("running")
    expect(await reopenSimpleInvoiceCancellingExport({ ...key, now: LATER(2_000) })).toBe(false)
    expect(exportStatus()).toEqual({ status: "running" })
    // Nothing out: reopened, and its queued export cancelled.
    exportRow("queued")
    expect(await reopenSimpleInvoiceCancellingExport({ ...key, now: LATER(3_000) })).toBe(true)
    expect(row("simple-open")).toMatchObject({ status: "draft" })
    expect(exportStatus()).toEqual({ status: "cancelled" })
  })

  it("migration 0322 only adds columns and an index (no table rebuild), including the unconfirmed mark", () => {
    const migration = readFileSync("drizzle/0322_invoice_email_claim.sql", "utf8")
    const statements = migration.split("--> statement-breakpoint").map((part) => part.replace(/^--.*$/gm, "").trim()).filter(Boolean)
    expect(statements.every((statement) => /^(ALTER TABLE `invoices` ADD COLUMN|CREATE INDEX IF NOT EXISTS)/.test(statement))).toBe(true)
    expect(migration).toContain("ADD COLUMN `email_unconfirmed_at` text")
  })
})

describe("email action wiring", () => {
  const source = readFileSync("src/app/actions/project-invoice-email.ts", "utf8")

  it("runs the read-only Square checks, then claims before the Square link and PDF", () => {
    const claimAt = source.indexOf("claimSimpleInvoiceEmail(db")
    expect(source.indexOf("await squareReadiness()")).toBeLessThan(claimAt)
    expect(claimAt).toBeLessThan(source.indexOf("startSquareInvoiceLink(db"))
    expect(claimAt).toBeLessThan(source.indexOf("invoicePdf(projectId, invoiceId)"))
  })

  it("renews its claim before the hand-off; keeps the claim on an unknown outcome or exception; records delivery with a retry", () => {
    const renew = source.indexOf("renewSimpleInvoiceEmail(db")
    const handOff = source.indexOf('outcome = "unknown"')
    expect(renew).toBeGreaterThan(0)
    expect(renew).toBeLessThan(handOff)
    expect(handOff).toBeLessThan(source.indexOf("await sendTrackedEmail("))
    expect(source).toMatch(/if \(!renewed\) return actionFailure/)
    expect(source).toMatch(/else if \(emailDefinitelyNotSent\(delivery\.status\)\) \{\s*outcome = "not_sent"/)
    expect(source).toMatch(/if \(outcome === "not_started" \|\| outcome === "not_sent"\) await releaseSimpleInvoiceEmail/)
    expect(source).toMatch(/if \(outcome === "unknown"\) await markSimpleInvoiceEmailUnconfirmed/)
    expect(source).toMatch(/if \(!\(await complete\(\)\) && !\(await complete\(\)\)\)/)
    expect(source).toContain("The email was sent, but Compass couldn't record it. Don't send it again.")
    expect(source).toContain("This invoice was voided. The email was not sent.")
    expect(source).toContain("This invoice was reopened as a draft. The email was not sent.")
    expect(source).toContain("settings.emailResendWindowMinutes")
  })
})

describe("reopen action wiring", () => {
  it("keeps Sage's single-batch reopen and adds the email fence to the same statement", () => {
    const source = readFileSync("src/app/actions/project-invoices.ts", "utf8")
    expect(source).toMatch(/db\.batch\(\[\s*reopenSimpleInvoiceStatement\(db, [\s\S]*?POSSIBLY_IN_SAGE_SQL[\s\S]*?cancelSageInvoiceArExportStatement\(db,/)
    expect(source).toContain("if (invoice.emailUnconfirmedAt) return actionFailure(EMAIL_UNCONFIRMED)")
  })
})
