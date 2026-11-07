import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The workflow row's amount update reads D1's result shape; not under test here.
vi.mock("@/lib/domain/operations/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/operations/store")>()),
  updateOperations: vi.fn(async () => 0),
}))

import { projectBudgetApplications, projectBudgetLines, projectContractDeposits, projectOperations, projects } from "@/db/schema"
import { payApplicationShopTicketImports, shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import { respreadShopTicketContributions, shopTicketContributionTargets } from "@/lib/domain/budget/rules"
import {
  attachShopTicket,
  detachShopTicket,
  importShopTickets,
  linkShopTicketsByNumber,
  loadPayApplicationShopTicketState,
  setShopTicketAlreadyIncluded,
} from "@/lib/financials/pay-application-shop-tickets"
import type { Db } from "@/lib/server/action-context"

// Fictional data only: a sample residence job and made-up ticket numbers.
const TABLES: readonly SQLiteTable[] = [
  projects,
  projectBudgetApplications,
  projectBudgetLines,
  projectContractDeposits,
  projectOperations,
  shopTickets,
  shopTicketLines,
  payApplicationShopTicketImports,
]

let sqlite: InstanceType<typeof Database>
let db: Db

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql =
      typeof value === "number"
        ? ` DEFAULT ${value}`
        : typeof value === "boolean"
          ? ` DEFAULT ${Number(value)}`
          : typeof value === "string"
            ? ` DEFAULT '${value.replaceAll("'", "''")}'`
            : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

const NOW = "2026-03-01T00:00:00.000Z"

function budgetLine(id: string, costCode: string, adjusted: number, current = 0, assemblyKey: string | null = null) {
  return {
    id,
    projectId: "job",
    applicationId: "app-3",
    budgetRevisionLineId: `rev-${costCode}`,
    sourceSystem: "compass_contract_budget",
    costCode,
    csiDivision: costCode.slice(0, 2),
    csiDivisionName: "Division",
    description: `Work ${costCode}`,
    originalEstimate: adjusted,
    adjustedEstimate: adjusted,
    currentWorkCompleted: current,
    currentCosts: current,
    totalCosts: current,
    balanceToFinish: adjusted - current,
    assemblyKey,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function ticket(id: string, sequence: number, payApplicationNumber: number | null, status: "draft" | "issued" | "void" = "issued") {
  return {
    id,
    organizationId: "org",
    projectId: "job",
    sequenceNumber: sequence,
    ticketNumber: `TK-${sequence}`,
    status,
    ticketDate: "2026-02-20",
    payApplicationNumber,
    payApplicationMonth: "2026-02-01",
    totalCents: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function ticketLine(id: string, ticketId: string, costCode: string, amountCents: number, rateKind: "labor" | "machine" = "labor") {
  return {
    id,
    ticketId,
    lineNumber: 1,
    costCode,
    description: "Crew hours",
    rateKind,
    hours: 1,
    rateCents: amountCents,
    amountCents,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

async function line(id: string) {
  return (await db.select().from(projectBudgetLines).where(eq(projectBudgetLines.id, id)).get())
}

async function linkedTo(ticketId: string) {
  return (await db.select({ id: shopTickets.budgetApplicationId }).from(shopTickets).where(eq(shopTickets.id, ticketId)).get())?.id
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) createTable(table)
  const base = drizzle(sqlite)
  const mock = {
    select: base.select.bind(base),
    update: base.update.bind(base),
    insert: base.insert.bind(base),
    delete: base.delete.bind(base),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  }
  // The test double covers the calls the module makes; D1's handle has more.
  db = mock as unknown as Db

  base.insert(projects).values({ id: "job", name: "Sample Residence", createdAt: NOW, updatedAt: NOW }).run()
  base
    .insert(projectBudgetApplications)
    .values({
      id: "app-3",
      projectId: "job",
      sourceSystem: "compass_contract_budget",
      applicationNumber: "3",
      status: "draft",
      contractSumToDate: 20_000,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run()
  base
    .insert(projectBudgetLines)
    .values([
      budgetLine("framing", "06 10 00", 3_000, 0, "asm:base"),
      budgetLine("framing-co", "06 10 00", 1_000, 0, "co:one"),
      budgetLine("concrete", "03 31 00", 5_000, 500),
    ])
    .run()
  base
    .insert(shopTickets)
    .values([ticket("t1", 1, 3), ticket("t2", 2, 4), ticket("t3", 3, 3, "draft"), ticket("t4", 4, 3)])
    .run()
  base
    .insert(shopTicketLines)
    .values([
      ticketLine("l1", "t1", "03 31 00", 20_000),
      ticketLine("l1b", "t1", "06 10 00", 40_000, "machine"),
      ticketLine("l2", "t2", "03 31 00", 5_000),
      ticketLine("l4", "t4", "03 31 00", 7_500),
      ticketLine("l4b", "t4", "31 23 00", 12_345),
    ])
    .run()
})

describe("shop tickets on an owner pay application", () => {
  it("links issued, unlinked tickets that name the draft's pay application number", async () => {
    expect(await linkShopTicketsByNumber(db, "job", "app-3")).toBe(2)
    expect(await linkedTo("t1")).toBe("app-3")
    expect(await linkedTo("t4")).toBe("app-3")
    expect(await linkedTo("t2")).toBeNull() // names pay app 4
    expect(await linkedTo("t3")).toBeNull() // still a draft
  })

  it("adds ticket amounts on top of current work and spreads a split cost code by scheduled value", async () => {
    await linkShopTicketsByNumber(db, "job", "app-3")
    const result = await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    // 500 already entered + 200 (TK-1) + 75 (TK-4)
    expect((await line("concrete"))?.currentWorkCompleted).toBe(775)
    // TK-1's $400 on 06 10 00 spread 3:1 across base and change-order shares.
    expect((await line("framing"))?.currentWorkCompleted).toBe(300)
    expect((await line("framing-co"))?.currentWorkCompleted).toBe(100)
    expect(result.addedCents).toBe(67_500)
    // A ticket line whose cost code has no G703 line is a warning, not imported.
    expect(result.warnings).toEqual([expect.stringContaining("TK-4: 31 23 00 ($123.45) has no line")])
    const application = await db.select().from(projectBudgetApplications).where(eq(projectBudgetApplications.id, "app-3")).get()
    expect(application?.totalCompletedStoredToDate).toBe(1_175)
  })

  it("re-importing adds only the difference and never doubles a ticket", async () => {
    await linkShopTicketsByNumber(db, "job", "app-3")
    await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    const again = await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    expect(again.addedCents).toBe(0)
    expect((await line("concrete"))?.currentWorkCompleted).toBe(775)

    // A ticket attached later is the only amount the next import adds.
    await attachShopTicket(db, "job", "app-3", "t2")
    const withNew = await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    expect(withNew.addedCents).toBe(5_000)
    expect((await line("concrete"))?.currentWorkCompleted).toBe(825)

    const state = await loadPayApplicationShopTicketState(db, "job", "app-3")
    expect(state.lineProvenance.find((entry) => entry.lineId === "concrete")).toEqual({
      lineId: "concrete",
      amountCents: 32_500,
      ticketNumbers: ["TK-1", "TK-2", "TK-4"],
    })
    expect(state.tickets.every((row) => row.pendingCents === 0)).toBe(true)
  })

  it("records an already-included ticket as billed without changing any line", async () => {
    await linkShopTicketsByNumber(db, "job", "app-3")
    await setShopTicketAlreadyIncluded(db, { projectId: "job", applicationId: "app-3", ticketId: "t1", included: true, userId: "staff", now: NOW })
    await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    // Only TK-4 imported; TK-1 was typed in by hand.
    expect((await line("concrete"))?.currentWorkCompleted).toBe(575)
    expect((await line("framing"))?.currentWorkCompleted).toBe(0)
    const state = await loadPayApplicationShopTicketState(db, "job", "app-3")
    expect(state.tickets.find((row) => row.id === "t1")).toMatchObject({ alreadyIncluded: true, importedCents: 0, pendingCents: 0 })
    // An imported ticket can't be switched to already included.
    await expect(
      setShopTicketAlreadyIncluded(db, { projectId: "job", applicationId: "app-3", ticketId: "t4", included: true, userId: "staff", now: NOW })
    ).rejects.toThrow("already imported")
  })

  it("unlinking a ticket takes its imported amounts back off", async () => {
    await linkShopTicketsByNumber(db, "job", "app-3")
    await importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })
    await detachShopTicket(db, { projectId: "job", applicationId: "app-3", ticketId: "t1", now: NOW })
    expect(await linkedTo("t1")).toBeNull()
    expect((await line("concrete"))?.currentWorkCompleted).toBe(575)
    expect((await line("framing"))?.currentWorkCompleted).toBe(0)
    expect((await line("framing-co"))?.currentWorkCompleted).toBe(0)
    const rows = await db.select().from(payApplicationShopTicketImports).where(eq(payApplicationShopTicketImports.ticketId, "t1"))
    expect(rows).toEqual([])
  })

  it("only changes a draft pay application", async () => {
    await linkShopTicketsByNumber(db, "job", "app-3")
    await db.update(projectBudgetApplications).set({ status: "internal_review" }).where(eq(projectBudgetApplications.id, "app-3"))
    await expect(importShopTickets(db, { projectId: "job", applicationId: "app-3", userId: "staff", now: NOW })).rejects.toThrow(
      "Only a draft"
    )
    await expect(attachShopTicket(db, "job", "app-3", "t2")).rejects.toThrow("Only a draft")
    expect(await linkShopTicketsByNumber(db, "job", "app-3")).toBe(0)
  })
})

describe("shop ticket contribution rules", () => {
  it("matches builder fee codes under their canonical name", () => {
    const { contributions, unmatched } = shopTicketContributionTargets(
      [{ id: "fee", costCode: "Company Overhead", adjustedEstimate: 1_000 }],
      [{ ticketId: "t", costCode: "99 10 00", amountCents: 1_000 }]
    )
    expect(unmatched).toEqual([])
    expect(contributions).toEqual([{ ticketId: "t", budgetLineId: "fee", amountCents: 1_000 }])
  })

  it("re-spreads a ticket's amount onto a cost code's new lines when a draft moves to a new budget revision", () => {
    const moved = respreadShopTicketContributions(
      [
        { ticketId: "t", budgetLineId: "old", amountCents: 1_000 },
        { ticketId: "t", budgetLineId: "kept", amountCents: 50 },
      ],
      new Map([["old", "06 10 00"]]),
      new Map([["06 10 00", [{ id: "new-base", weightCents: 300_000 }, { id: "new-co", weightCents: 100_000 }]]])
    )
    expect(moved).toEqual([
      { ticketId: "t", budgetLineId: "new-base", amountCents: 750 },
      { ticketId: "t", budgetLineId: "new-co", amountCents: 250 },
    ])
  })
})
