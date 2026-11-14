import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { pickRecipientAnswers, vendorRfqRecipientAnswers } from "@/lib/domain/operations/rfq-recipients"
import { insertRow } from "@/test/migrated-database"

/*
 * project_rfq_recipients (migration 0326) against the real migrated schema:
 * a vendor reads only its own company's answers, merges are followed, and
 * the rows go with their RFQ.
 */

let sqlite: ReturnType<typeof migratedDb>["sqlite"]
let db: ReturnType<typeof migratedDb>["db"]

function vendor(id: string, mergedInto: string | null = null, organizationId = "org-1"): void {
  insertRow(sqlite, "vendors", { id, organization_id: organizationId, name: id, merged_into_vendor_id: mergedInto })
}

function recipient(id: string, vendorId: string, values: Readonly<Record<string, string | number | null>> = {}): void {
  insertRow(sqlite, "project_rfq_recipients", {
    id,
    project_id: "proj-1",
    rfq_operation_id: "rfq-1",
    vendor_id: vendorId,
    response_status: "quoted",
    quote_amount_cents: null,
    responded_at: null,
    source_system: "buildertrend",
    source_record_id: id,
    created_at: "2026-11-13T00:00:00.000Z",
    ...values,
  })
}

beforeEach(() => {
  ;({ sqlite, db } = migratedDb())
  sqlite.pragma("foreign_keys = ON")
  insertRow(sqlite, "organizations", { id: "org-1", type: "internal" })
  insertRow(sqlite, "organizations", { id: "org-2", type: "internal" })
  insertRow(sqlite, "projects", { id: "proj-1", organization_id: "org-1", name: "Job" })
  insertRow(sqlite, "project_operations", { id: "rfq-1", project_id: "proj-1", source_system: "buildertrend", source_record_type: "rfq", title: "Cabinetry", status: "closed" })
  insertRow(sqlite, "project_operations", { id: "rfq-2", project_id: "proj-1", source_system: "buildertrend", source_record_type: "rfq", title: "Counters", status: "closed" })
  vendor("v-front-range")
  vendor("v-designer")
  vendor("v-front-range-dup", "v-front-range")
  vendor("v-other-org", null, "org-2")
})

afterEach(() => sqlite.close())

const scope = { organizationId: "org-1", projectId: "proj-1", vendorCompanyName: "Front Range Cabinets" }

describe("RFQ recipients", () => {
  it("returns only the viewer's own company's answer", async () => {
    recipient("bid-1", "v-front-range", { quote_amount_cents: 1981698, responded_at: "2024-06-18" })
    recipient("bid-2", "v-designer", { quote_amount_cents: 897500 })
    recipient("bid-3", "v-designer", { rfq_operation_id: "rfq-2", response_status: "declined" })

    const answers = await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-front-range" })
    expect([...answers.keys()]).toEqual(["rfq-1"])
    expect(answers.get("rfq-1")).toMatchObject({ decision: "quote", amount: 19816.98 })
    expect(JSON.stringify([...answers.values()])).not.toContain("8975")

    const designer = await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-designer" })
    expect(designer.get("rfq-1")?.amount).toBe(8975)
    expect(designer.get("rfq-2")?.decision).toBe("decline")
  })

  it("follows duplicate merges both ways and stays inside the company", async () => {
    recipient("bid-1", "v-front-range-dup", { quote_amount_cents: 100 })
    expect((await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-front-range" })).get("rfq-1")?.amount).toBe(1)
    expect((await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-front-range-dup" })).get("rfq-1")?.amount).toBe(1)
    expect((await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-designer" })).size).toBe(0)
    expect((await vendorRfqRecipientAnswers(db, { ...scope, vendorId: "v-other-org" })).size).toBe(0)
    expect((await vendorRfqRecipientAnswers(db, { ...scope, vendorId: null })).size).toBe(0)
  })

  it("is unique per source answer and goes with its RFQ", () => {
    recipient("bid-1", "v-front-range")
    expect(() => recipient("bid-1b", "v-front-range", { source_record_id: "bid-1" })).toThrow(/UNIQUE/)
    sqlite.prepare("DELETE FROM project_operations WHERE id = 'rfq-1'").run()
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_rfq_recipients").get()).toEqual({ n: 0 })
  })

  it("picks one answer per RFQ: newest first, a quote over a decline", () => {
    const base = { rfqOperationId: "rfq-1", quoteAmountCents: null, enteredByBuilder: false }
    const picked = pickRecipientAnswers([
      { ...base, id: "a", responseStatus: "declined", respondedAt: "2025-01-02" },
      { ...base, id: "b", responseStatus: "quoted", respondedAt: "2025-01-02" },
      { ...base, id: "c", responseStatus: "quoted", respondedAt: "2025-01-01" },
    ])
    expect(picked.get("rfq-1")?.id).toBe("b")
  })
})
