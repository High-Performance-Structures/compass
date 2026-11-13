import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, sql } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import {
  sageArInvoiceExports,
  sageChangeOrderExports,
  sageClientProjectWriteOperations,
  sageDirectoryAddRequests,
  sageEstimateExports,
  sageVendorCertificateSyncs,
} from "@/db/schema-sage"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { sageClientWriteResultCustomerStatement, sageSnapshotDirectoryUpdateStatement, sageVendorUpdateStatement } from "@/lib/domain/contacts/store"
import {
  cancelSageArInvoiceExport,
  cancelSageInvoiceArExport,
  cancelSageInvoiceArExportStatement,
  claimSageArInvoiceExport,
  claimSageInvoiceArExport,
  updateSageArInvoiceExportsStatement,
  upsertSageArInvoiceExport,
  upsertSageInvoiceArExport,
} from "@/lib/domain/sage-bridge/ar-invoice-store"
import { queueSageChangeOrderExports, updateSageChangeOrderExportsStatement } from "@/lib/domain/sage-bridge/change-order-store"
import { moveSageDirectoryAddRequest, sageDirectoryAddOutcomeStatement } from "@/lib/domain/sage-bridge/directory-add-store"
import { updateSageEstimateExportsStatement } from "@/lib/domain/sage-bridge/estimate-store"
import { EDITED_WHILE_SENDING, estimateEditedAfterClaim } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
import {
  arInvoiceExportMachine,
  changeOrderExportMachine,
  clientProjectWriteMachine,
  directoryAddMachine,
  estimateExportMachine,
  sourcesInto,
  vendorCertificateSyncMachine,
} from "@/lib/domain/sage-bridge/machines"
import {
  SAGE_AR_INVOICE_EXPORT_STATUSES,
  SAGE_CHANGE_ORDER_EXPORT_STATUSES,
  SAGE_CLIENT_PROJECT_WRITE_STATUSES,
  SAGE_DIRECTORY_ADD_STATUSES,
  SAGE_ESTIMATE_EXPORT_STATUSES,
  SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES,
} from "@/lib/domain/sage-bridge/statuses"
import {
  claimSageClientProjectWrite,
  finishVendorCertificateSync,
  releaseSageResultLease,
  requeueFailedSageClientProjectWriteStatement,
  sageClientProjectWriteSucceededStatement,
  sageResultAlreadyRecorded,
  sageVendorWriteSucceededStatement,
  sageWriteSucceededUnderLease,
  takeSageResultLease,
  updateSageClientProjectWriteOperations,
  updateVendorCertificateSyncs,
} from "@/lib/domain/sage-bridge/store"
import { simpleInvoiceMoveStatement } from "@/lib/domain/financials/store"
import { applySimpleInvoiceSageResult } from "@/lib/financials/simple-invoice-sage-result"
import { queueApprovedSageAdd } from "@/lib/sage/directory-add-service"
import { noNewSageHoldCondition, noNewSageHoldGuard } from "@/lib/sage/sage-held-fields"
import type { Db } from "@/lib/server/action-context"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

/*
 * The Sage write queues' machines, the stores' compare-and-set writes against
 * a database built from every migration (two polls, a retried result, a staff
 * resend while the writer runs, an approval racing a withdrawal, a sync racing
 * a staff edit), and a guard that no status write bypasses the stores.
 */

const ORG = "org-1"
const NOW = "2026-11-12T10:00:00.000Z"
const LATER = "2026-11-12T10:30:00.000Z"
const STALE_BEFORE = "2026-11-12T09:50:00.000Z"

let sqlite: ReturnType<typeof migratedDatabase>
let d1: D1Database
let db: Db

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function statusOf(table: string, id: string): unknown {
  const row: unknown = sqlite.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id)
  return typeof row === "object" && row !== null ? Reflect.get(row, "status") : undefined
}

function countOf(sqlText: string, ...binds: unknown[]): unknown {
  const row: unknown = sqlite.prepare(sqlText).get(...binds)
  return typeof row === "object" && row !== null ? Reflect.get(row, "n") : undefined
}

function insertWrite(id: string, status: string, claimToken: string | null = null, claimedAt: string | null = null): void {
  insert("sage_client_project_write_operations", {
    id, organization_id: ORG, operation_type: "ensure_client_and_job", idempotency_key: `k-${id}`,
    payload_json: "{}", status, claim_token: claimToken, claimed_at: claimedAt, requested_at: NOW, updated_at: NOW,
  })
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  d1 = d1Over(sqlite)
  db = drizzle(d1)
})

describe("Sage write queue machines", () => {
  it("are well formed over their status lists", () => {
    expect(machineProblems(clientProjectWriteMachine)).toEqual([])
    expect(machineProblems(changeOrderExportMachine)).toEqual([])
    expect(machineProblems(vendorCertificateSyncMachine)).toEqual([])
    expect(machineProblems(estimateExportMachine)).toEqual([])
    expect(machineProblems(arInvoiceExportMachine)).toEqual([])
    expect(machineProblems(directoryAddMachine)).toEqual([])
    expect(clientProjectWriteMachine.states).toEqual(SAGE_CLIENT_PROJECT_WRITE_STATUSES)
    expect(changeOrderExportMachine.states).toEqual(SAGE_CHANGE_ORDER_EXPORT_STATUSES)
    expect(vendorCertificateSyncMachine.states).toEqual(SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES)
    expect(estimateExportMachine.states).toEqual(SAGE_ESTIMATE_EXPORT_STATUSES)
    expect(arInvoiceExportMachine.states).toEqual(SAGE_AR_INVOICE_EXPORT_STATUSES)
    expect(directoryAddMachine.states).toEqual(SAGE_DIRECTORY_ADD_STATUSES)
  })

  it("only a running request can finish, and nothing leaves succeeded", () => {
    const finishing = [clientProjectWriteMachine, changeOrderExportMachine, estimateExportMachine, arInvoiceExportMachine]
    for (const machine of finishing) {
      expect(machine.transitions.succeed.from).toEqual(["running"])
      expect(machine.transitions.fail.from).toEqual(["running"])
    }
    expect(availableEvents(clientProjectWriteMachine, "succeeded")).toEqual([])
    expect(availableEvents(changeOrderExportMachine, "succeeded")).toEqual([])
    expect(availableEvents(estimateExportMachine, "succeeded")).toEqual([])
    expect(availableEvents(arInvoiceExportMachine, "succeeded")).toEqual([])
    expect(sourcesInto(arInvoiceExportMachine, "succeeded")).toEqual(["running"])
    expect(sourcesInto(clientProjectWriteMachine, "queued")).toEqual(["failed"])
  })

  it("a resend or new queue never touches a request the writer is running", () => {
    expect(clientProjectWriteMachine.transitions.resend.from).not.toContain("running")
    expect(changeOrderExportMachine.transitions.resend.from).not.toContain("running")
    expect(estimateExportMachine.transitions.queue.from).not.toContain("running")
    expect(arInvoiceExportMachine.transitions.queue.from).not.toContain("running")
    expect(arInvoiceExportMachine.transitions.cancel.from).not.toContain("running")
  })

  it("an add request goes to the writer only after approval, and a withdrawal only before it is sent", () => {
    expect(directoryAddMachine.transitions.send.from).toEqual(["approved"])
    expect(directoryAddMachine.transitions.withdraw.from).toEqual(["pending", "approved"])
    expect(availableEvents(directoryAddMachine, "cancelled")).toEqual([])
  })
})

describe("client/job writes: claims, leases and resends", () => {
  it("two polls claim a queued write once; a stale claim can be taken over", async () => {
    insertWrite("w1", "queued")
    expect(await claimSageClientProjectWrite(db, { id: "w1", claimToken: "a", now: NOW, staleBefore: STALE_BEFORE })).toBe(true)
    expect(await claimSageClientProjectWrite(db, { id: "w1", claimToken: "b", now: NOW, staleBefore: STALE_BEFORE })).toBe(false)
    expect(sqlite.prepare("SELECT claim_token, attempt_count FROM sage_client_project_write_operations WHERE id = 'w1'").get())
      .toEqual({ claim_token: "a", attempt_count: 1 })
    // Ten minutes on, the claim is stale and another poll takes it over.
    expect(await claimSageClientProjectWrite(db, { id: "w1", claimToken: "b", now: LATER, staleBefore: "2026-11-12T10:20:00.000Z" })).toBe(true)
  })

  it("a result posted twice takes the lease once; a failed apply hands it back", async () => {
    insertWrite("w1", "running", "claim-1", NOW)
    const lease = { id: "w1", organizationId: ORG, claimToken: "claim-1" }
    const first = await takeSageResultLease(db, "sage_client_project_write_operations", { ...lease, now: NOW })
    expect(first).toBe("claim-1:result")
    expect(await takeSageResultLease(db, "sage_client_project_write_operations", { ...lease, now: NOW })).toBeNull()
    await releaseSageResultLease(db, "sage_client_project_write_operations", lease)
    expect(await takeSageResultLease(db, "sage_client_project_write_operations", { ...lease, now: NOW })).toBe(first)
  })

  it("an exact repeat of a recorded result is recognised; a superseded claim's is not", async () => {
    insertWrite("w1", "running", "claim-1", NOW)
    const leaseToken = await takeSageResultLease(db, "sage_client_project_write_operations", { id: "w1", organizationId: ORG, claimToken: "claim-1", now: NOW })
    if (!leaseToken) throw new Error("no lease")
    await updateSageClientProjectWriteOperations(db, { status: "failed", errorMessage: "x", completedAt: LATER, updatedAt: LATER },
      and(eq(sageClientProjectWriteOperations.id, "w1"), eq(sageClientProjectWriteOperations.claimToken, leaseToken)))
    const repeat = { id: "w1", organizationId: null, claimToken: "claim-1" }
    expect(await sageResultAlreadyRecorded(db, "sage_client_project_write_operations", { ...repeat, statuses: ["failed"] })).toBe("failed")
    // Another outcome, or another (superseded) claim, is not the result that landed.
    expect(await sageResultAlreadyRecorded(db, "sage_client_project_write_operations", { ...repeat, statuses: ["succeeded"] })).toBeNull()
    expect(await sageResultAlreadyRecorded(db, "sage_client_project_write_operations", { ...repeat, claimToken: "claim-0", statuses: ["failed"] })).toBeNull()
    expect(await sageResultAlreadyRecorded(db, "sage_client_project_write_operations", { ...repeat, organizationId: "org-2", statuses: ["failed"] })).toBeNull()
  })

  it("the hand-set cancelled state is never written or left by the store", async () => {
    expect(sourcesInto(clientProjectWriteMachine, "cancelled")).toEqual([])
    expect(availableEvents(clientProjectWriteMachine, "cancelled")).toEqual([])
    insertWrite("w1", "cancelled")
    insertWrite("w2", "failed")
    await requeueFailedSageClientProjectWriteStatement(d1, { operationId: "w1", organizationId: ORG, customerId: null, payloadJson: "{}", now: LATER }).run()
    expect(await claimSageClientProjectWrite(db, { id: "w1", claimToken: "a", now: LATER, staleBefore: LATER })).toBe(false)
    const cancelled = await updateSageClientProjectWriteOperations(db, { status: "cancelled", updatedAt: LATER }, eq(sageClientProjectWriteOperations.id, "w2"))
      .returning({ id: sageClientProjectWriteOperations.id })
    expect(cancelled).toEqual([])
    expect([statusOf("sage_client_project_write_operations", "w1"), statusOf("sage_client_project_write_operations", "w2")]).toEqual(["cancelled", "failed"])
  })

  it("a superseded claim's success doesn't land; the lease holder's does, once", async () => {
    insertWrite("w1", "running", "lease-1", NOW)
    const success = {
      operationId: "w1", clientId: "C", clientNumber: "1", clientStatusNumber: 1,
      jobId: null, jobNumber: null, jobStatusNumber: null, jobTypeNumber: null, now: LATER,
    }
    expect((await sageClientProjectWriteSucceededStatement(d1, { ...success, leaseToken: "old-claim" }).run()).meta.changes).toBe(0)
    expect((await sageClientProjectWriteSucceededStatement(d1, { ...success, leaseToken: "lease-1" }).run()).meta.changes).toBe(1)
    expect((await sageClientProjectWriteSucceededStatement(d1, { ...success, leaseToken: "lease-1" }).run()).meta.changes).toBe(0)
    expect(statusOf("sage_client_project_write_operations", "w1")).toBe("succeeded")
  })

  it("Send to Sage while the writer is running (or after it succeeded) changes nothing", async () => {
    insertWrite("running", "running", "c", NOW)
    insertWrite("done", "succeeded")
    insertWrite("failed", "failed")
    for (const id of ["running", "done", "failed"]) {
      await requeueFailedSageClientProjectWriteStatement(d1, { operationId: id, organizationId: ORG, customerId: null, payloadJson: "{}", now: LATER }).run()
    }
    expect([statusOf("sage_client_project_write_operations", "running"), statusOf("sage_client_project_write_operations", "done"), statusOf("sage_client_project_write_operations", "failed")])
      .toEqual(["running", "succeeded", "queued"])
  })

  it("a status patch only lands from a state the machine allows", async () => {
    insertWrite("w1", "succeeded")
    const failed = await updateSageClientProjectWriteOperations(db, { status: "failed", updatedAt: LATER }, eq(sageClientProjectWriteOperations.id, "w1"))
      .returning({ id: sageClientProjectWriteOperations.id })
    expect(failed).toEqual([])
    expect(statusOf("sage_client_project_write_operations", "w1")).toBe("succeeded")
  })
})

describe("exports: AR invoices, change orders, estimates, certificates", () => {
  function insertArExport(id: string, status: string, claimToken: string | null = null): void {
    insert("sage_ar_invoice_exports", {
      id, organization_id: ORG, project_id: "p1", application_id: `app-${id}`, status, invoice_number: "J-PR01",
      claim_token: claimToken, claimed_at: claimToken ? NOW : null, requested_at: NOW, updated_at: NOW,
    })
  }

  it("taking billing back loses to a writer claim that landed first, and re-billing leaves the running row alone", async () => {
    insertArExport("ar1", "queued")
    expect(await claimSageArInvoiceExport(db, { id: "ar1", organizationId: ORG, claimToken: "c1", now: NOW, staleBefore: STALE_BEFORE })).toBe(true)
    expect(await cancelSageArInvoiceExport(db, { organizationId: ORG, applicationId: "app-ar1", now: LATER })).toBe(false)
    const requeued = await upsertSageArInvoiceExport(db, {
      organizationId: ORG, projectId: "p1", applicationId: "app-ar1", status: "queued", invoiceNumber: "J-PR01",
      requestedByUserId: null, automatic: true, errorMessage: null, now: LATER,
    })
    expect(requeued).toBe(false)
    expect(sqlite.prepare("SELECT status, claim_token FROM sage_ar_invoice_exports WHERE id = 'ar1'").get()).toEqual({ status: "running", claim_token: "c1" })
  })

  it("a cancelled AR invoice can't be marked succeeded by a late result", async () => {
    insertArExport("ar1", "cancelled", "c1")
    const updated = await updateSageArInvoiceExportsStatement(db, and(eq(sageArInvoiceExports.id, "ar1"), eq(sageArInvoiceExports.claimToken, "c1")), {
      status: "succeeded", completedAt: LATER, updatedAt: LATER,
    }).returning({ id: sageArInvoiceExports.id })
    expect(updated).toEqual([])
    expect(statusOf("sage_ar_invoice_exports", "ar1")).toBe("cancelled")
  })

  it("an AR result posted twice applies once", async () => {
    insertArExport("ar1", "running", "c1")
    const lease = { id: "ar1", organizationId: ORG, claimToken: "c1" }
    const [first, second] = await Promise.all([
      takeSageResultLease(db, "sage_ar_invoice_exports", { ...lease, now: NOW }),
      takeSageResultLease(db, "sage_ar_invoice_exports", { ...lease, now: NOW }),
    ])
    expect([first, second].filter((token) => token !== null)).toHaveLength(1)
  })

  it("a change order is sent again only from failed, and only a running one finishes", async () => {
    insert("sage_change_order_exports", {
      id: "co1", organization_id: ORG, project_id: "p1", change_order_id: "chg1", status: "running", sage_change_order_number: "3",
      payload_json: "{}", claim_token: "c1", claimed_at: NOW, requested_at: NOW, updated_at: NOW,
    })
    const queued = await queueSageChangeOrderExports(db, [{
      organizationId: ORG, projectId: "p1", changeOrderId: "chg1", sageChangeOrderNumber: "3", payloadJson: "{\"edited\":true}", requestedByUserId: "u1", now: LATER,
    }])
    expect(queued).toEqual([])
    expect(sqlite.prepare("SELECT status, payload_json FROM sage_change_order_exports WHERE id = 'co1'").get()).toEqual({ status: "running", payload_json: "{}" })
    sqlite.exec("UPDATE sage_change_order_exports SET status = 'failed' WHERE id = 'co1'")
    const late = await updateSageChangeOrderExportsStatement(db, eq(sageChangeOrderExports.id, "co1"), { status: "succeeded", updatedAt: LATER })
      .returning({ id: sageChangeOrderExports.id })
    expect(late).toEqual([])
  })

  it("an estimate export can't jump from queued to succeeded", async () => {
    insert("sage_estimate_exports", {
      id: "e1", organization_id: ORG, project_id: "p1", estimate_id: "est1", status: "queued", requested_at: NOW, updated_at: NOW,
    })
    const updated = await updateSageEstimateExportsStatement(db, eq(sageEstimateExports.id, "e1"), { status: "succeeded", updatedAt: LATER })
      .returning({ id: sageEstimateExports.id })
    expect(updated).toEqual([])
  })

  it("an estimate edited after its export was claimed is flagged for staff when the result lands, not re-sent", async () => {
    expect(estimateEditedAfterClaim("2026-11-12T10:05:00.000Z", NOW)).toBe(true)
    expect(estimateEditedAfterClaim("2026-11-12T09:55:00.000Z", NOW)).toBe(false)
    expect(estimateEditedAfterClaim(null, NOW)).toBe(false)
    insert("sage_estimate_exports", {
      id: "e1", organization_id: ORG, project_id: "p1", estimate_id: "est1", status: "running", claim_token: "c1", claimed_at: NOW, requested_at: NOW, updated_at: NOW,
    })
    const leaseToken = await takeSageResultLease(db, "sage_estimate_exports", { id: "e1", organizationId: ORG, claimToken: "c1", now: LATER })
    if (!leaseToken) throw new Error("no lease")
    // The success lands as needs attention: Sage has the proposal, staff check it.
    const flagged = await updateSageEstimateExportsStatement(db, and(eq(sageEstimateExports.id, "e1"), eq(sageEstimateExports.claimToken, leaseToken)), {
      status: "needs_attention", errorMessage: EDITED_WHILE_SENDING, completedAt: LATER, updatedAt: LATER,
    }).returning({ id: sageEstimateExports.id })
    expect(flagged).toEqual([{ id: "e1" }])
    // Nothing re-queues it on its own: no claim takes a needs-attention row.
    expect(estimateExportMachine.transitions.claim.from).not.toContain("needs_attention")
  })

  it("a certificate sync finishes only from running", async () => {
    insert("sage_vendor_certificate_syncs", {
      id: "s1", organization_id: ORG, vendor_id: "v1", status: "queued", requested_at: NOW, updated_at: NOW,
    })
    expect(await updateVendorCertificateSyncs(db, eq(sageVendorCertificateSyncs.id, "s1"), { status: "succeeded", updatedAt: LATER })).toBe(0)
    sqlite.exec("UPDATE sage_vendor_certificate_syncs SET status = 'running' WHERE id = 's1'")
    expect(await updateVendorCertificateSyncs(db, eq(sageVendorCertificateSyncs.id, "s1"), { status: "queued", updatedAt: LATER })).toBe(1)
  })
})

describe("review fixes: certificates, leases, links, void records", () => {
  it("a certificate result lands in one write, requeued when docs changed meanwhile", async () => {
    insert("sage_vendor_certificate_syncs", {
      id: "s1", organization_id: ORG, vendor_id: "v1", status: "running", claim_token: "c1", claimed_at: NOW, requested_at: NOW, updated_at: NOW,
    })
    insert("sage_vendor_certificate_syncs", {
      id: "s2", organization_id: ORG, vendor_id: "v2", status: "running", claim_token: "c2", claimed_at: NOW, requested_at: LATER, updated_at: NOW,
    })
    const patch = { errorMessage: null, completedAt: LATER, updatedAt: LATER }
    expect(await finishVendorCertificateSync(db, { id: "s1", claimToken: "c1", outcome: "succeeded", patch })).toBe(1)
    expect(await finishVendorCertificateSync(db, { id: "s2", claimToken: "c2", outcome: "succeeded", patch })).toBe(1)
    expect([statusOf("sage_vendor_certificate_syncs", "s1"), statusOf("sage_vendor_certificate_syncs", "s2")]).toEqual(["succeeded", "queued"])
    // A stale claim's result lands nowhere.
    expect(await finishVendorCertificateSync(db, { id: "s1", claimToken: "old", outcome: "failed", patch })).toBe(0)
  })

  it("taking a result's lease refreshes the claim, so a poll can't take it over as stale meanwhile", async () => {
    insertWrite("w1", "running", "c1", "2026-11-12T09:00:00.000Z")
    expect(await takeSageResultLease(db, "sage_client_project_write_operations", { id: "w1", organizationId: ORG, claimToken: "c1", now: LATER })).toBe("c1:result")
    expect(await claimSageClientProjectWrite(db, { id: "w1", claimToken: "poll", now: LATER, staleBefore: "2026-11-12T10:20:00.000Z" })).toBe(false)
  })

  it("the client and job links land only with the success under the lease", async () => {
    insertWrite("w1", "running", "c1:result", NOW)
    insert("customers", { id: "cust", organization_id: ORG, name: "Acme", created_at: NOW, updated_at: NOW })
    const guard = {
      sql: "EXISTS (SELECT 1 FROM sage_client_project_write_operations WHERE id = ? AND claim_token = ? AND status = 'succeeded' AND completed_at = ?)",
      binds: ["w1", "c1:result", LATER],
    }
    const customer = { customerId: "cust", sageClientId: "SC", sageClientNumber: "7", sageClientStatusId: 1, now: LATER }
    // The success didn't land (still running): the link doesn't either.
    expect((await sageClientWriteResultCustomerStatement(d1, customer, guard).run()).meta.changes).toBe(0)
    await sageClientProjectWriteSucceededStatement(d1, {
      operationId: "w1", leaseToken: "c1:result", clientId: "SC", clientNumber: "7", clientStatusNumber: 1,
      jobId: null, jobNumber: null, jobStatusNumber: null, jobTypeNumber: null, now: LATER,
    }).run()
    expect((await sageClientWriteResultCustomerStatement(d1, customer, guard).run()).meta.changes).toBe(1)
  })

  function insertInvoiceExport(id: string, status: string, invoiceStatus: string): void {
    insert("invoices", { id: `inv-${id}`, organization_id: ORG, customer_id: "c", status: invoiceStatus, issue_date: NOW, created_at: NOW, updated_at: NOW })
    insert("sage_invoice_ar_exports", {
      id, organization_id: ORG, project_id: "p1", invoice_id: `inv-${id}`, status, invoice_number: "J-INV01", requested_at: NOW, updated_at: NOW,
    })
  }

  it("a void invoice is never claimed for the writer: its queued export is cancelled", async () => {
    insertInvoiceExport("x1", "queued", "void")
    insertInvoiceExport("x2", "queued", "open")
    expect(await claimSageInvoiceArExport(db, { id: "x1", organizationId: ORG, claimToken: "c", now: LATER, staleBefore: STALE_BEFORE })).toBe(false)
    expect(await claimSageInvoiceArExport(db, { id: "x2", organizationId: ORG, claimToken: "c", now: LATER, staleBefore: STALE_BEFORE })).toBe(true)
    expect([statusOf("sage_invoice_ar_exports", "x1"), statusOf("sage_invoice_ar_exports", "x2")]).toEqual(["cancelled", "running"])
  })

  it("a stale running export of a record voided since is flagged for staff, not left running", async () => {
    insertInvoiceExport("x1", "running", "void")
    sqlite.exec("UPDATE sage_invoice_ar_exports SET claim_token = 'old', claimed_at = '2026-11-12T09:00:00.000Z' WHERE id = 'x1'")
    expect(await claimSageInvoiceArExport(db, { id: "x1", organizationId: ORG, claimToken: "c", now: LATER, staleBefore: STALE_BEFORE })).toBe(false)
    expect(sqlite.prepare("SELECT status, error_message FROM sage_invoice_ar_exports WHERE id = 'x1'").get())
      .toEqual({ status: "needs_attention", error_message: "Voided while Sage was adding it; check Sage." })
  })

  it("an export Sage already has (it carries Sage's record id) is never cancelled", async () => {
    insertInvoiceExport("x1", "needs_attention", "open")
    sqlite.exec("UPDATE sage_invoice_ar_exports SET sage_record_id = '901' WHERE id = 'x1'")
    expect(await cancelSageInvoiceArExport(db, { organizationId: ORG, invoiceId: "inv-x1", now: LATER })).toBe(false)
    expect(statusOf("sage_invoice_ar_exports", "x1")).toBe("needs_attention")
  })

  it("a repeat only counts as recorded with the same outcome and Sage record", async () => {
    insertInvoiceExport("x1", "running", "open")
    sqlite.exec("UPDATE sage_invoice_ar_exports SET claim_token = 'c1' WHERE id = 'x1'")
    const leaseToken = await takeSageResultLease(db, "sage_invoice_ar_exports", { id: "x1", organizationId: ORG, claimToken: "c1", now: NOW })
    sqlite.prepare("UPDATE sage_invoice_ar_exports SET status = 'needs_attention', sage_record_id = '901' WHERE id = 'x1' AND claim_token = ?").run(leaseToken)
    const repeat = { id: "x1", organizationId: ORG, claimToken: "c1" }
    expect(await sageResultAlreadyRecorded(db, "sage_invoice_ar_exports", { ...repeat, statuses: ["succeeded", "needs_attention"], sageRecordId: "901" })).toBe("needs_attention")
    expect(await sageResultAlreadyRecorded(db, "sage_invoice_ar_exports", { ...repeat, statuses: ["succeeded", "needs_attention"], sageRecordId: "902" })).toBeNull()
    expect(await sageResultAlreadyRecorded(db, "sage_invoice_ar_exports", { ...repeat, statuses: ["needs_attention"], sageRecordId: null })).toBeNull()
  })

  it("a simple invoice result posted twice at once applies once", async () => {
    insertInvoiceExport("x1", "running", "open")
    sqlite.exec("UPDATE sage_invoice_ar_exports SET claim_token = 'c1' WHERE id = 'x1'")
    const result = { outcome: "failed" as const, id: "x1", claimToken: "c1", error: "Sage said no", needsAttention: false }
    const answers = await Promise.all([applySimpleInvoiceSageResult(db, ORG, result), applySimpleInvoiceSageResult(db, ORG, result)])
    expect(answers.filter((answer) => answer !== null)).toEqual([{ status: "failed", httpStatus: 202 }])
    expect(await sageResultAlreadyRecorded(db, "sage_invoice_ar_exports", { id: "x1", organizationId: ORG, claimToken: "c1", statuses: ["failed"], sageRecordId: null }))
      .toBe("failed")
  })

  it("reopen and its export cancel are one batch: never when Sage has the invoice (its record id) or a payment landed", async () => {
    const reopen = (id: string) => db.batch([
      simpleInvoiceMoveStatement(db, { invoiceId: `inv-${id}`, organizationId: ORG, projectId: "p1" }, "reopen", { updatedAt: LATER }, and(
        sql`amount_paid = 0`,
        sql`NOT EXISTS (SELECT 1 FROM sage_invoice_ar_exports e WHERE e.invoice_id = ${`inv-${id}`}
          AND (e.status IN ('running', 'succeeded') OR e.sage_record_id IS NOT NULL))`,
      )),
      cancelSageInvoiceArExportStatement(db, {
        organizationId: ORG, invoiceId: `inv-${id}`, now: LATER,
        when: sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${`inv-${id}`} AND status = 'draft' AND updated_at = ${LATER})`,
      }),
    ])
    for (const id of ["queued", "inSage", "paid"]) {
      insertInvoiceExport(id, id === "inSage" ? "needs_attention" : "queued", "open")
      sqlite.prepare("UPDATE invoices SET project_id = 'p1', invoice_kind = 'invoice' WHERE id = ?").run(`inv-${id}`)
    }
    sqlite.exec("UPDATE sage_invoice_ar_exports SET sage_record_id = '901' WHERE id = 'inSage'")
    sqlite.exec("UPDATE invoices SET amount_paid = 10 WHERE id = 'inv-paid'")
    const [reopened] = await reopen("queued")
    expect(reopened).toHaveLength(1)
    expect(statusOf("sage_invoice_ar_exports", "queued")).toBe("cancelled")
    for (const id of ["inSage", "paid"]) {
      const [blocked] = await reopen(id)
      expect(blocked, id).toEqual([])
      expect(sqlite.prepare("SELECT status FROM invoices WHERE id = ?").get(`inv-${id}`)).toEqual({ status: "open" })
    }
    expect([statusOf("sage_invoice_ar_exports", "inSage"), statusOf("sage_invoice_ar_exports", "paid")]).toEqual(["needs_attention", "queued"])
  })

  it("queuing a voided invoice's export again changes nothing", async () => {
    insertInvoiceExport("x1", "failed", "void")
    const written = await upsertSageInvoiceArExport(db, {
      organizationId: ORG, projectId: "p1", invoiceId: "inv-x1", status: "queued", invoiceNumber: "J-INV01", requestedByUserId: null, errorMessage: null, now: LATER,
    })
    expect(written).toBe(false)
    expect(statusOf("sage_invoice_ar_exports", "x1")).toBe("failed")
  })

  it("reopening cancels the export only when the reopen itself landed", async () => {
    insertInvoiceExport("x1", "queued", "open")
    const cancel = (now: string) => cancelSageInvoiceArExportStatement(db, {
      organizationId: ORG, invoiceId: "inv-x1", now,
      when: sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${"inv-x1"} AND status = 'draft' AND updated_at = ${now})`,
    })
    // The invoice is still open (the reopen lost): the export stays queued.
    await cancel(LATER)
    expect(statusOf("sage_invoice_ar_exports", "x1")).toBe("queued")
    sqlite.prepare("UPDATE invoices SET status = 'draft', updated_at = ? WHERE id = 'inv-x1'").run(LATER)
    await cancel(LATER)
    expect(statusOf("sage_invoice_ar_exports", "x1")).toBe("cancelled")
  })
})

describe("Request add to Sage", () => {
  function insertRequest(id: string, status: string): void {
    insert("sage_directory_add_requests", {
      id, organization_id: ORG, kind: "vendor_company", entity_id: `vendor-${id}`,
      fields_json: JSON.stringify({ name: "Photon Brothers", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, phone: null, email: null }),
      vendor_type: "Subcontractor", form_1099: "unknown", status, requested_at: NOW, updated_at: NOW,
    })
  }

  async function requestRow(id: string) {
    const row = await db.select().from(sageDirectoryAddRequests).where(eq(sageDirectoryAddRequests.id, id)).get()
    if (!row) throw new Error("missing request")
    return row
  }

  it("a withdrawal that lands after the approval stops the vendor from reaching the Sage writer", async () => {
    insertRequest("r1", "pending")
    expect(await moveSageDirectoryAddRequest(db, { id: "r1", organizationId: ORG, event: "approve", values: { updatedAt: NOW } })).toBe(1)
    const approved = await requestRow("r1")
    expect(await moveSageDirectoryAddRequest(db, { id: "r1", organizationId: ORG, event: "withdraw", values: { updatedAt: NOW } })).toBe(1)
    const result = await queueApprovedSageAdd(db, approved, "approver", LATER)
    expect(result.status).toBe("cancelled")
    expect(countOf("SELECT count(*) AS n FROM sage_client_project_write_operations")).toBe(0)
    expect(statusOf("sage_directory_add_requests", "r1")).toBe("cancelled")
  })

  it("two callers queuing the same approved request queue one writer request", async () => {
    insertRequest("r1", "approved")
    const row = await requestRow("r1")
    const results = await Promise.all([queueApprovedSageAdd(db, row, "approver", LATER), queueApprovedSageAdd(db, row, "approver", LATER)])
    expect(results.map((result) => result.status)).toEqual(["sent", "sent"])
    expect(countOf("SELECT count(*) AS n FROM sage_client_project_write_operations WHERE idempotency_key = 'sage-add:r1'")).toBe(1)
    expect(sqlite.prepare("SELECT status, write_operation_id IS NOT NULL AS linked FROM sage_directory_add_requests WHERE id = 'r1'").get())
      .toEqual({ status: "sent", linked: 1 })
  })

  it("a writer request already waiting for this add request is linked, not queued twice", async () => {
    insertRequest("r1", "approved")
    insertWrite("existing", "queued")
    sqlite.exec("UPDATE sage_client_project_write_operations SET idempotency_key = 'sage-add:r1' WHERE id = 'existing'")
    const result = await queueApprovedSageAdd(db, await requestRow("r1"), "approver", LATER)
    expect(result.status).toBe("sent")
    expect(sqlite.prepare("SELECT status, write_operation_id FROM sage_directory_add_requests WHERE id = 'r1'").get())
      .toEqual({ status: "sent", write_operation_id: "existing" })
    expect(countOf("SELECT count(*) AS n FROM sage_client_project_write_operations")).toBe(1)
  })

  it("a failed writer request for it is sent again and linked", async () => {
    insertRequest("r1", "approved")
    insertWrite("existing", "failed")
    sqlite.exec("UPDATE sage_client_project_write_operations SET idempotency_key = 'sage-add:r1' WHERE id = 'existing'")
    const result = await queueApprovedSageAdd(db, await requestRow("r1"), "approver", LATER)
    expect(result.status).toBe("sent")
    expect(statusOf("sage_client_project_write_operations", "existing")).toBe("queued")
    expect(sqlite.prepare("SELECT status, write_operation_id FROM sage_directory_add_requests WHERE id = 'r1'").get())
      .toEqual({ status: "sent", write_operation_id: "existing" })
  })

  it("a succeeded writer request for it finishes the request with Sage's vendor", async () => {
    insertRequest("r1", "approved")
    insertWrite("existing", "succeeded")
    sqlite.exec("UPDATE sage_client_project_write_operations SET idempotency_key = 'sage-add:r1', sage_vendor_id = 'SV', sage_vendor_number = '42' WHERE id = 'existing'")
    const result = await queueApprovedSageAdd(db, await requestRow("r1"), "approver", LATER)
    expect(result.status).toBe("succeeded")
    expect(sqlite.prepare("SELECT status, sage_record_number FROM sage_directory_add_requests WHERE id = 'r1'").get())
      .toEqual({ status: "succeeded", sage_record_number: "42" })
  })

  it("a cancelled writer request for it is not linked; the request waits approved", async () => {
    insertRequest("r1", "approved")
    insertWrite("existing", "cancelled")
    sqlite.exec("UPDATE sage_client_project_write_operations SET idempotency_key = 'sage-add:r1' WHERE id = 'existing'")
    const result = await queueApprovedSageAdd(db, await requestRow("r1"), "approver", LATER)
    expect(result.status).toBe("approved")
    expect(statusOf("sage_directory_add_requests", "r1")).toBe("approved")
  })

  it("a vendor result's add-request outcome lands only with the success under the lease", async () => {
    insertRequest("r1", "sent")
    sqlite.exec("UPDATE sage_directory_add_requests SET write_operation_id = 'w1' WHERE id = 'r1'")
    insertWrite("w1", "running", "c1:result", NOW)
    const guard = sageWriteSucceededUnderLease({ operationId: "w1", leaseToken: "c1:result", now: LATER })
    const outcome = (event: "succeed" | "fail") => sageDirectoryAddOutcomeStatement(d1, {
      requestId: "r1", organizationId: ORG, operationId: "w1", event, sageRecordId: "SV", sageRecordNumber: "42", errorMessage: null, now: LATER, guard,
    })
    const results = await d1.batch([
      sageVendorWriteSucceededStatement(d1, { operationId: "w1", leaseToken: "stale", vendorId: "SV", vendorNumber: "42", now: LATER }),
      outcome("succeed"),
    ])
    expect(results.map((result) => result.meta.changes)).toEqual([0, 0])
    const landed = await d1.batch([
      sageVendorWriteSucceededStatement(d1, { operationId: "w1", leaseToken: "c1:result", vendorId: "SV", vendorNumber: "42", now: LATER }),
      outcome("succeed"),
    ])
    expect(landed.map((result) => result.meta.changes)).toEqual([1, 1])
    expect(statusOf("sage_directory_add_requests", "r1")).toBe("succeeded")
  })

  it("the writer's answer only finishes the request it was sent for", async () => {
    insertRequest("r1", "sent")
    sqlite.exec("UPDATE sage_directory_add_requests SET write_operation_id = 'op-new' WHERE id = 'r1'")
    expect(await moveSageDirectoryAddRequest(db, {
      id: "r1", organizationId: ORG, event: "succeed", where: eq(sageDirectoryAddRequests.writeOperationId, "op-old"), values: { updatedAt: LATER },
    })).toBe(0)
    expect(statusOf("sage_directory_add_requests", "r1")).toBe("sent")
  })
})

describe("Sage → Compass syncs never overwrite a pending Compass edit", () => {
  function insertVendorWithHold(holdId: string): void {
    insert("vendors", { id: "v1", organization_id: ORG, name: "Photon Brothers", primary_email: "new@photon.test", sage_vendor_id: "SAGE-V1", created_at: NOW, updated_at: NOW })
    insert("sage_contact_change_proposals", {
      id: holdId, organization_id: ORG, kind: "vendor_company", entity_id: "v1", sage_record_id: "SAGE-V1",
      base_revision: "r1", changes_json: JSON.stringify([{ field: "primaryEmail", before: "old@photon.test", after: "new@photon.test" }]),
      status: "pending", requested_by_user_id: "u1", requested_at: NOW, updated_at: NOW,
    })
  }

  it("the vendor list's write stops when a staff edit opened a change after the holds were read", async () => {
    insertVendorWithHold("hold-new")
    const stale = await sageVendorUpdateStatement(db, {
      vendorId: "v1", organizationId: ORG, sageRecordId: "SAGE-V1", patch: { primaryEmail: "old@photon.test" }, now: LATER,
      guard: noNewSageHoldCondition({ organizationId: ORG, kind: "vendor_company", entityId: "v1", seen: [] }),
    })
    expect(stale).toEqual([])
    // With the hold seen (its field left out of the patch), the rest syncs.
    const fresh = await sageVendorUpdateStatement(db, {
      vendorId: "v1", organizationId: ORG, sageRecordId: "SAGE-V1", patch: { phone: "719-555-0100" }, now: LATER,
      guard: noNewSageHoldCondition({ organizationId: ORG, kind: "vendor_company", entityId: "v1", seen: ["hold-new"] }),
    })
    expect(fresh).toEqual([{ id: "v1" }])
    expect(sqlite.prepare("SELECT primary_email, phone FROM vendors WHERE id = 'v1'").get()).toEqual({ primary_email: "new@photon.test", phone: "719-555-0100" })
  })

  it("a Sage read-back's write stops the same way", async () => {
    insertVendorWithHold("hold-new")
    const guard = noNewSageHoldGuard({ organizationId: ORG, kind: "vendor_company", entityId: "v1", seen: [] })
    const result = await sageSnapshotDirectoryUpdateStatement(d1, "vendor_company", "sage_vendor_id = ?, primary_email = ?, updated_at = ?",
      ["SAGE-V1", "old@photon.test", LATER, LATER, "v1", ORG, "SAGE-V1"], guard).run()
    expect(result.meta.changes).toBe(0)
    expect(sqlite.prepare("SELECT primary_email FROM vendors WHERE id = 'v1'").get()).toEqual({ primary_email: "new@photon.test" })
  })

  it("staff records, which hold nothing, are not guarded", () => {
    expect(noNewSageHoldGuard({ organizationId: ORG, kind: "employee", entityId: "e1", seen: [] })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Guard: Sage write queue status writes go through the sage-bridge stores.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

let sources: ReadonlyMap<string, string> | null = null
function sourceTree(): ReadonlyMap<string, string> {
  sources ??= new Map(sourceFiles("src").map((file) => [file, readFileSync(file, "utf8")]))
  return sources
}

const QUEUES = [
  ["sageClientProjectWriteOperations", "sage_client_project_write_operations", "src/lib/domain/sage-bridge/store.ts"],
  ["sageVendorCertificateSyncs", "sage_vendor_certificate_syncs", "src/lib/domain/sage-bridge/store.ts"],
  ["sageChangeOrderExports", "sage_change_order_exports", "src/lib/domain/sage-bridge/change-order-store.ts"],
  ["sageEstimateExports", "sage_estimate_exports", "src/lib/domain/sage-bridge/estimate-store.ts"],
  ["sageArInvoiceExports", "sage_ar_invoice_exports", "src/lib/domain/sage-bridge/ar-invoice-store.ts"],
  ["sageInvoiceArExports", "sage_invoice_ar_exports", "src/lib/domain/sage-bridge/ar-invoice-store.ts"],
  ["sageDepositArExports", "sage_deposit_ar_exports", "src/lib/domain/sage-bridge/ar-invoice-store.ts"],
  ["sageDirectoryAddRequests", "sage_directory_add_requests", "src/lib/domain/sage-bridge/directory-add-store.ts"],
] as const

describe("Sage write queue status guard", { timeout: 120_000 }, () => {
  it("only each queue's store writes it", () => {
    for (const [drizzleName, tableName, store] of QUEUES) {
      const pattern = new RegExp(`\\.(update|insert|delete)\\((schema\\.)?${drizzleName}\\)|(UPDATE|INSERT INTO|DELETE FROM)\\s+${tableName}\\b`)
      const writers = [...sourceTree()].filter(([, source]) => pattern.test(source)).map(([file]) => file)
      expect(writers, tableName).toEqual([store])
    }
  })

  it("every store write of a status is fenced on the machine", () => {
    const store = readFileSync("src/lib/domain/sage-bridge/store.ts", "utf8")
    expect(store).toContain("clientProjectWriteMayEnter(changes.status)")
    expect(store).toContain("sourcesInto(vendorCertificateSyncMachine, patch.status)")
    expect(readFileSync("src/lib/domain/sage-bridge/change-order-store.ts", "utf8")).toContain("sourcesInto(changeOrderExportMachine, patch.status)")
    expect(readFileSync("src/lib/domain/sage-bridge/estimate-store.ts", "utf8")).toContain("sourcesInto(estimateExportMachine, patch.status)")
    const ar = readFileSync("src/lib/domain/sage-bridge/ar-invoice-store.ts", "utf8")
    expect(ar.match(/inArray\(sage\w+\.status, mayEnter\(patch\.status\)\)/g)).toHaveLength(3)
    const adds = readFileSync("src/lib/domain/sage-bridge/directory-add-store.ts", "utf8")
    expect(adds).toContain("directoryAddMachine.transitions[input.event]")
    expect(adds).not.toMatch(/fromStatuses/)
  })

  it("writer results apply under a lease, never by id alone", () => {
    for (const route of [
      "src/app/api/integrations/sage/client-project-writes/results/route.ts",
      "src/app/api/integrations/sage/change-orders/results/route.ts",
      "src/app/api/integrations/sage/estimates/results/route.ts",
      "src/app/api/integrations/sage/ar-invoices/results/route.ts",
    ]) {
      const source = readFileSync(route, "utf8")
      expect(source, route).toContain("takeSageResultLease(")
      // An exact repeat of a recorded result answers 200, not 409 (the writer stops its run on non-2xx).
      expect(source, route).toContain("sageResultAlreadyRecorded(")
      expect(source, route).not.toMatch(/eq\(sage\w+\.id, operation\.id\)\s*\)/)
    }
  })
})
