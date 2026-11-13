import Database from "better-sqlite3"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { eq } from "drizzle-orm"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { projectChangeOrders } from "@/db/schema"
import { allowedChangeOrderTransitions } from "@/lib/change-orders/status"
import { isBatchGuardFailure } from "@/lib/d1-query"
import { changeOrderMachine, staffEventFor } from "@/lib/domain/estimates/change-order-machine"
import { CHANGE_ORDER_STATUSES, type ChangeOrderStatus } from "@/lib/domain/estimates/statuses"
import {
  insertChangeOrderHistoryStatement,
  updateChangeOrdersStatement,
} from "@/lib/domain/estimates/store"
import { changeOrderMoveStatements, changeOrderStatusGuardStatement, changeOrderStatusStatement } from "@/lib/domain/estimates/change-order-status-store"
import { machineProblems } from "@/lib/shared/state-machine"

/*
 * The change order machine (staff picks and Compass's own moves), the
 * store's compare-and-set moves against a database built from every
 * migration, and a guard that no status write bypasses the store.
 */

// The staff transition table as it stood before the machine (issue #1329).
const STAFF_TABLE: Readonly<Record<ChangeOrderStatus, readonly ChangeOrderStatus[]>> = {
  draft: ["submitted", "void"],
  submitted: ["triage", "needs_information", "declined", "void"],
  triage: ["needs_information", "pricing", "internal_review", "declined", "void"],
  needs_information: ["submitted", "triage", "pricing", "declined", "void"],
  pricing: ["needs_information", "internal_review", "declined", "void"],
  internal_review: ["needs_information", "pricing", "approved_for_owner", "declined", "void"],
  approved_for_owner: ["internal_review", "signature_pending", "declined", "void"],
  signature_pending: ["approved_for_owner", "executed", "declined", "void"],
  executed: ["sage_pending", "closed"],
  sage_pending: ["executed", "synced"],
  synced: ["closed"],
  closed: [],
  declined: [],
  void: [],
}

describe("change order machine", () => {
  it("is well formed over the shared status list", () => {
    expect(machineProblems(changeOrderMachine)).toEqual([])
    expect(changeOrderMachine.states).toEqual(CHANGE_ORDER_STATUSES)
  })

  it("offers staff exactly the moves they had before", () => {
    for (const status of CHANGE_ORDER_STATUSES) expect(allowedChangeOrderTransitions(status)).toEqual(STAFF_TABLE[status])
    expect(staffEventFor("draft")).toBeNull()
  })

  it("never executes a declined, voided or closed change order", () => {
    for (const event of ["execute", "execute_from_estimate", "record_acceptance", "approve_variance", "sign_selection_round", "execute_rebaseline"] as const) {
      for (const status of ["declined", "void", "closed"] as const) expect(changeOrderMachine.transitions[event].from).not.toContain(status)
    }
  })

  it("approves a variance only before it is executed", () => {
    expect(changeOrderMachine.transitions.approve_variance.from).not.toContain("executed")
    expect(changeOrderMachine.transitions.record_acceptance.from).not.toContain("executed")
  })
})

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-12T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const db = new Database(":memory:")
    const dir = join(process.cwd(), "drizzle")
    for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
    }
    migratedImage = db.serialize()
    db.close()
  }
  return new Database(migratedImage)
}

function changeOrder(): unknown {
  return sqlite.prepare("SELECT status, amount_cents AS amountCents FROM project_change_orders WHERE id = 'co'").get()
}

function historyCount(): unknown {
  return sqlite.prepare("SELECT count(*) AS n FROM project_change_order_history").get()
}

function history(db: ReturnType<typeof drizzleOverSqlite>, toStatus: ChangeOrderStatus) {
  return insertChangeOrderHistoryStatement(db, {
    id: crypto.randomUUID(),
    projectId: "p1",
    changeOrderId: "co",
    eventType: "status_transition",
    fromStatus: "signature_pending",
    toStatus,
    actorName: "Pat PM",
    actorRole: "project_manager",
    createdAt: NOW,
  })
}

describe("change order status writes", () => {
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
      INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, requester_type, requester_name, source_type, status, amount_cents, created_at, updated_at)
        VALUES ('co', 'p1', 'CO-001', 'Pump', 'Add a sump pump', 'internal', 'Pat PM', 'compass', 'signature_pending', 125000, '${NOW}', '${NOW}');
    `)
  })
  afterEach(() => sqlite.close())

  async function execute(): Promise<boolean> {
    const db = drizzleOverSqlite(sqlite)
    try {
      await db.batch([
        ...changeOrderMoveStatements(db, { changeOrderId: "co", projectId: "p1", event: "execute", expected: "signature_pending", values: { executedAt: NOW, updatedAt: NOW } }),
        history(db, "executed"),
      ])
      return true
    } catch (error) {
      if (isBatchGuardFailure(error)) return false
      throw error
    }
  }

  it("executes once: a second click writes no second history entry", async () => {
    expect(await execute()).toBe(true)
    expect(await execute()).toBe(false)
    expect(changeOrder()).toEqual({ status: "executed", amountCents: 125000 })
    expect(historyCount()).toEqual({ n: 1 })
  })

  it("never executes a change order voided meanwhile", async () => {
    sqlite.exec("UPDATE project_change_orders SET status = 'void'")
    expect(await execute()).toBe(false)
    expect(changeOrder()).toMatchObject({ status: "void" })
    expect(historyCount()).toEqual({ n: 0 })
  })

  it("an edit lands only on the status it was made against", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec("UPDATE project_change_orders SET status = 'executed'")
    const error = await db
      .batch([
        changeOrderStatusGuardStatement(db, { changeOrderId: "co", projectId: "p1", expected: "signature_pending" }),
        updateChangeOrdersStatement(db, eq(projectChangeOrders.id, "co"), { amountCents: 999, updatedAt: NOW }),
      ])
      .catch((caught: unknown) => caught)
    expect(isBatchGuardFailure(error)).toBe(true)
    expect(changeOrder()).toEqual({ status: "executed", amountCents: 125000 })
  })

  it("an automatic move that no longer applies is skipped and the rest of the batch runs", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec("UPDATE project_change_orders SET status = 'executed'")
    await db.batch([
      changeOrderStatusStatement(db, { changeOrderId: "co", event: "cancel_selection_round", values: { updatedAt: NOW } }),
      history(db, "void"),
    ])
    expect(changeOrder()).toMatchObject({ status: "executed" })
    expect(historyCount()).toEqual({ n: 1 })
  })

  it("refuses a move the machine doesn't allow from the status read", () => {
    const db = drizzleOverSqlite(sqlite)
    expect(() => changeOrderMoveStatements(db, { changeOrderId: "co", event: "approve_variance", expected: "executed" })).toThrow(/not allowed/)
  })

  it("plain updates refuse a status", () => {
    const db = drizzleOverSqlite(sqlite)
    const patch = { updatedAt: NOW }
    Reflect.set(patch, "status", "executed")
    expect(() => updateChangeOrdersStatement(db, eq(projectChangeOrders.id, "co"), patch)).toThrow(/changeOrderMoveStatements/)
  })
})

// ---------------------------------------------------------------------------
// Guard: change order status writes go through the estimates store.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("change order status write guard", { timeout: 30_000 }, () => {
  it("only the estimates store updates project_change_orders", () => {
    const writers = sourceFiles("src").filter((file) =>
      /\.update\((schema\.)?projectChangeOrders\)|UPDATE\s+project_change_orders\b/i.test(readFileSync(file, "utf8")),
    )
    expect(writers).toEqual(["src/lib/domain/estimates/store.ts"])
  })

  it("the store's status moves read the machine and are compare-and-set", () => {
    const statusStore = readFileSync("src/lib/domain/estimates/change-order-status-store.ts", "utf8")
    expect(statusStore).toContain("changeOrderMachine.transitions[move.event]")
    expect(statusStore).toContain("inArray(projectChangeOrders.status, [...from])")
    // Only the status store passes a status to the store's raw write.
    const rawWriters = sourceFiles("src").filter((file) => /changeOrderWriteStatement\(/.test(readFileSync(file, "utf8")))
    expect(rawWriters).toEqual(["src/lib/domain/estimates/change-order-status-store.ts", "src/lib/domain/estimates/store.ts"])
    expect(readFileSync("src/lib/domain/estimates/store.ts", "utf8")).toContain('if ("status" in patch) throw')
  })
})
