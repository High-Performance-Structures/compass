import { desc } from "drizzle-orm"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it } from "vitest"

import { projectBudgetApplications, projectBudgetLines, projectContractDeposits, projectOperations } from "@/db/schema"
import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import { recordImportedDrawDeposit, undoImportedDrawDeposit } from "@/lib/domain/budget/store"
import {
  importedDrawDepositAmount,
  importedDrawDepositUndoBlocker,
  parseImportedDepositUndoReason,
  recordableDepositCents,
} from "@/lib/financials/contract-deposits"
import {
  availableDepositForApplication,
  priorPayApplicationCondition,
  refreshAutoDepositPayApplications,
} from "@/lib/financials/owner-pay-application-refresh"
import type { Db } from "@/lib/server/action-context"

/*
 * A deposit billed before Compass was applied on an imported draw. Staff
 * record it there so the next Compass draft does not apply it again. Fictional
 * project: a $10,000.00 deposit, imported draws 1 and 2, then a Compass draft.
 */

function tableSql(table: SQLiteTable): string {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql =
      typeof value === "number" ? ` DEFAULT ${value}`
        : typeof value === "boolean" ? ` DEFAULT ${Number(value)}`
          : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'`
            : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  return `CREATE TABLE "${config.name}" (${columns.join(", ")});`
}

const now = "2026-11-06T12:00:00.000Z"
let db: Db
let sqlite: ReturnType<typeof sqliteDb>["sqlite"]

function application(id: string, values: Partial<typeof projectBudgetApplications.$inferInsert>): typeof projectBudgetApplications.$inferInsert {
  return {
    id,
    projectId: "p1",
    sourceSystem: "google_drive_g702_g703",
    applicationNumber: id,
    status: "submitted",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...values,
  }
}

beforeEach(async () => {
  const created = sqliteDb(
    [projectBudgetApplications, projectBudgetLines, projectContractDeposits, projectOperations].map(tableSql).join("\n")
  )
  sqlite = created.sqlite
  db = created.db
  await db.insert(projectContractDeposits).values({
    id: "dep-1", projectId: "p1", status: "received", receivedAmountCents: 1_000_000, receivedAt: "2025-03-01",
    sourceSystem: "compass", createdAt: now, updatedAt: now,
  })
  await db.insert(projectBudgetApplications).values([
    application("1", { periodTo: "2025-04-30", totalEarnedLessRetainage: 30_000, currentPaymentDue: 20_000 }),
    application("2", { periodTo: "2025-05-31", status: "current", totalEarnedLessRetainage: 60_000, previousCertificates: 30_000, currentPaymentDue: 30_000 }),
    application("snap", { sourceSystem: "sage_read_snapshot", status: "imported_draft", periodTo: "2025-12-31", totalEarnedLessRetainage: 99_000 }),
  ])
})

/** A Compass draft that applies the deposit automatically: $10,000 of work this period. */
async function addDraft(id = "draft-3", status = "draft"): Promise<void> {
  await db.insert(projectBudgetApplications).values(application(id, {
    sourceSystem: "compass_contract_budget", status, periodTo: "2025-06-30", depositAppliedMode: "auto",
    totalEarnedLessRetainage: 70_000, previousCertificates: 60_000, createdAt: "2026-02-01",
  }))
  await db.insert(projectBudgetLines).values({
    id: `${id}-line`, projectId: "p1", applicationId: id, sourceSystem: "compass_contract_budget", costCode: "01-100", csiDivision: "01", csiDivisionName: "General Requirements",
    description: "General conditions", totalCosts: 70_000, createdAt: now, updatedAt: now,
  })
}

function depositOn(id: string): unknown {
  return sqlite.prepare("SELECT deposit_applied, deposit_applied_mode, current_payment_due FROM project_budget_applications WHERE id = ?").get(id)
}

describe("recording a deposit applied on an imported draw", () => {
  it("counts it, so the next Compass draft does not apply it again", async () => {
    await addDraft()
    await refreshAutoDepositPayApplications(db, "p1", now)
    // Before: the draft takes the whole deposit a second time.
    expect(depositOn("draft-3")).toEqual({ deposit_applied: 10_000, deposit_applied_mode: "auto", current_payment_due: 0 })

    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 1_000_000, now })).toBe(true)
    await refreshAutoDepositPayApplications(db, "p1", now)
    expect(depositOn("1")).toMatchObject({ deposit_applied: 10_000, deposit_applied_mode: "recorded", current_payment_due: 20_000 })
    expect(depositOn("draft-3")).toEqual({ deposit_applied: 0, deposit_applied_mode: "auto", current_payment_due: 10_000 })
    expect(await availableDepositForApplication(db, "p1", "draft-3")).toBe(0)
  })

  it("records part of the deposit, leaving the rest for the next draft", async () => {
    await addDraft()
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 400_000, now })).toBe(true)
    await refreshAutoDepositPayApplications(db, "p1", now)
    expect(depositOn("draft-3")).toMatchObject({ deposit_applied: 6_000, current_payment_due: 4_000 })
  })

  it("refuses more than the received deposit not yet applied", async () => {
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 1_000_001, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 600_000, now })).toBe(true)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "2", cents: 400_001, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "2", cents: 400_000, now })).toBe(true)
  })

  it("counts submitted Compass draws against the deposit, but not drafts that apply it automatically", async () => {
    await addDraft("review-3", "internal_review")
    sqlite.prepare("UPDATE project_budget_applications SET deposit_applied = 2500 WHERE id = 'review-3'").run()
    await addDraft("draft-4")
    sqlite.prepare("UPDATE project_budget_applications SET deposit_applied = 7500 WHERE id = 'draft-4'").run()
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 750_001, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 750_000, now })).toBe(true)
  })

  it("only records on an imported billed draw with no deposit yet", async () => {
    await addDraft()
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "draft-3", cents: 100, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "snap", cents: 100, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "other", applicationId: "1", cents: 100, now })).toBe(false)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 100, now })).toBe(true)
    expect(await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 100, now })).toBe(false)
  })
})

describe("removing a recorded deposit", () => {
  it("frees the deposit for drafts again", async () => {
    await addDraft()
    await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 1_000_000, now })
    expect(await undoImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", now })).toBe(true)
    await refreshAutoDepositPayApplications(db, "p1", now)
    expect(depositOn("1")).toMatchObject({ deposit_applied: 0, deposit_applied_mode: "auto" })
    expect(depositOn("draft-3")).toMatchObject({ deposit_applied: 10_000 })
  })

  it("is refused once a Compass pay application is past draft, or when nothing was recorded", async () => {
    expect(await undoImportedDrawDeposit(db, { projectId: "p1", applicationId: "2", now })).toBe(false)
    await recordImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", cents: 1_000_000, now })
    await addDraft("billed-3", "billed")
    expect(await undoImportedDrawDeposit(db, { projectId: "p1", applicationId: "1", now })).toBe(false)
    expect(depositOn("1")).toMatchObject({ deposit_applied: 10_000, deposit_applied_mode: "recorded" })
  })
})

describe("imported draw deposit rules", () => {
  it("leaves out drafts that apply the deposit automatically", () => {
    expect(recordableDepositCents({ receivedCents: 1_000_000, lockedAppliedDollars: 2_500 })).toBe(750_000)
    expect(recordableDepositCents({ receivedCents: 100, lockedAppliedDollars: 5 })).toBe(0)
  })

  it("checks the amount", () => {
    expect(importedDrawDepositAmount({ amountDollars: 10_000, recordableCents: 1_000_000 })).toEqual({ ok: true, cents: 1_000_000 })
    expect(importedDrawDepositAmount({ amountDollars: 10_000.01, recordableCents: 1_000_000 })).toMatchObject({ ok: false })
    expect(importedDrawDepositAmount({ amountDollars: null, recordableCents: 1_000_000 })).toMatchObject({ ok: false })
    expect(importedDrawDepositAmount({ amountDollars: 5, recordableCents: 0 })).toMatchObject({ ok: false })
  })

  it("needs a reason and no submitted Compass draw to remove one", () => {
    expect(importedDrawDepositUndoBlocker({ mode: "recorded", submittedCompassDraws: 0 })).toBeNull()
    expect(importedDrawDepositUndoBlocker({ mode: "recorded", submittedCompassDraws: 1 })).toMatch(/past draft/)
    expect(importedDrawDepositUndoBlocker({ mode: "auto", submittedCompassDraws: 0 })).toMatch(/No deposit/)
    expect(parseImportedDepositUndoReason("  ")).toMatchObject({ ok: false })
    expect(parseImportedDepositUndoReason(" Wrong draw ")).toEqual({ ok: true, reason: "Wrong draw" })
  })
})

describe("prior draw for a new draft", () => {
  async function prior(): Promise<string | undefined> {
    const rows = await db
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(priorPayApplicationCondition("p1"))
      .orderBy(desc(projectBudgetApplications.periodTo), desc(projectBudgetApplications.createdAt))
      .limit(1)
    return rows[0]?.id
  }

  it("never takes a Sage job-cost snapshot, or a void or superseded draw", async () => {
    // The snapshot has the latest period but is not a draw.
    expect(await prior()).toBe("2")
    await db.insert(projectBudgetApplications).values([
      application("void-3", { status: "void", periodTo: "2025-07-31" }),
      application("old-3", { status: "superseded", periodTo: "2025-07-31" }),
      application("building-3", { sourceSystem: "compass_contract_budget", status: "building", periodTo: "2025-08-31" }),
    ])
    expect(await prior()).toBe("2")
  })
})
