import Database from "better-sqlite3"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { eq } from "drizzle-orm"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { projectBudgetApplications, projectBudgetLines, projectOperations } from "@/db/schema"
import { isBatchGuardFailure } from "@/lib/d1-query"
import { payApplicationMachine } from "@/lib/domain/budget/pay-application-machine"
import { PAY_APPLICATION_STATUSES } from "@/lib/domain/budget/statuses"
import {
  draftPayApplicationGuardStatement,
  deleteBudgetLinesStatement,
  movePayApplicationStatus,
  updateBudgetApplications,
  updateBudgetLinesStatement,
  updateDraftPayApplicationLines,
} from "@/lib/domain/budget/store"
import { sendPayApplicationForReview } from "@/lib/domain/budget/pay-application-review"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { refreshOwnerPayApplication } from "@/lib/financials/owner-pay-application-refresh"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

/*
 * The Compass draw (owner pay application) machine, the budget store's
 * compare-and-set moves and draft-only line edits against a database built
 * from every migration, and a guard that no status write bypasses the store.
 */

describe("pay application machine", () => {
  it("is well formed over the shared status list", () => {
    expect(machineProblems(payApplicationMachine)).toEqual([])
    expect(payApplicationMachine.states).toEqual(PAY_APPLICATION_STATUSES)
  })

  it("bills only a reviewed draw, and only a billed one can be taken back", () => {
    expect(availableEvents(payApplicationMachine, "building")).toEqual(["finish"])
    expect(availableEvents(payApplicationMachine, "draft")).toEqual(["mark_ready"])
    expect(availableEvents(payApplicationMachine, "internal_review")).toEqual(["return_to_draft", "approve"])
    expect(availableEvents(payApplicationMachine, "billed")).toEqual(["undo_billing"])
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

function draw(): unknown {
  return sqlite.prepare("SELECT status, owner_visible AS ownerVisible FROM project_budget_applications WHERE id = 'app'").get()
}

function operationStatus(): unknown {
  return sqlite.prepare("SELECT status FROM project_operations WHERE id = 'op'").get()
}

describe("Compass draw status writes", () => {
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
      INSERT INTO project_budget_applications (id, project_id, source_system, application_number, status, created_at, updated_at)
        VALUES ('app', 'p1', 'compass_contract_budget', '3', 'internal_review', '${NOW}', '${NOW}');
      INSERT INTO project_budget_lines (id, project_id, application_id, source_system, cost_code, csi_division, csi_division_name, description, current_work_completed, created_at, updated_at)
        VALUES ('line', 'p1', 'app', 'compass_contract_budget', '03 30 00', '03', 'Concrete', 'Footings', 1000, '${NOW}', '${NOW}');
      INSERT INTO project_operations (id, project_id, source_system, source_record_type, source_record_id, source_record_number, title, status, created_at, updated_at)
        VALUES ('op', 'p1', 'compass', 'owner_pay_application', 'app', '3', 'Owner pay application 3', 'internal_review', '${NOW}', '${NOW}');
    `)
  })
  afterEach(() => sqlite.close())

  function approve() {
    const db = drizzleOverSqlite(sqlite)
    return movePayApplicationStatus(db, {
      projectId: "p1",
      applicationId: "app",
      event: "approve",
      values: { ownerVisible: true, updatedAt: NOW },
      alongWith: [operationUpdateQuery(db, eq(projectOperations.id, "op"), { status: "billed", updatedAt: NOW })],
    })
  }

  it("approves once; the second approval writes nothing, not even its workflow item", async () => {
    expect(await approve()).toBe(true)
    expect(draw()).toEqual({ status: "billed", ownerVisible: 1 })
    sqlite.exec("UPDATE project_operations SET status = 'marker' WHERE id = 'op'")
    expect(await approve()).toBe(false)
    expect(operationStatus()).toEqual({ status: "marker" })
  })

  it("never moves a draw that isn't a Compass draw", async () => {
    sqlite.exec("UPDATE project_budget_applications SET source_system = 'buildertrend'")
    expect(await approve()).toBe(false)
    expect(draw()).toMatchObject({ status: "internal_review" })
  })

  it("a further condition refuses the move", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec("UPDATE project_budget_applications SET status = 'billed', sage_invoice_number = '25031'")
    expect(await movePayApplicationStatus(db, {
      projectId: "p1",
      applicationId: "app",
      event: "undo_billing",
      also: eq(projectBudgetApplications.sageInvoiceNumber, "none"),
    })).toBe(false)
    expect(draw()).toMatchObject({ status: "billed" })
  })

  it("line edits land only on a draft", async () => {
    const db = drizzleOverSqlite(sqlite)
    const edit = () => updateDraftPayApplicationLines(db, { projectId: "p1", applicationId: "app", where: eq(projectBudgetLines.id, "line"), patch: { currentWorkCompleted: 5000 } })
    expect(await edit()).toBe(0)
    sqlite.exec("UPDATE project_budget_applications SET status = 'draft'")
    expect(await edit()).toBe(1)
    expect(sqlite.prepare("SELECT current_work_completed AS amount FROM project_budget_lines").get()).toEqual({ amount: 5000 })
  })

  it("a draft guard rolls back the whole batch once the draw went to review", async () => {
    const db = drizzleOverSqlite(sqlite)
    const error = await db
      .batch([
        draftPayApplicationGuardStatement(db, "p1", "app"),
        updateBudgetLinesStatement(db, eq(projectBudgetLines.id, "line"), { currentWorkCompleted: 0 }),
        deleteBudgetLinesStatement(db, eq(projectBudgetLines.id, "line")),
      ])
      .catch((caught: unknown) => caught)
    expect(isBatchGuardFailure(error)).toBe(true)
    expect(sqlite.prepare("SELECT current_work_completed AS amount FROM project_budget_lines").get()).toEqual({ amount: 1000 })
  })

  it("plain updates refuse a status", async () => {
    const db = drizzleOverSqlite(sqlite)
    // A spread from an untyped source can carry status past the type.
    const patch = { updatedAt: NOW }
    Reflect.set(patch, "status", "billed")
    await expect(updateBudgetApplications(db, eq(projectBudgetApplications.id, "app"), patch)).rejects.toThrow(/status functions/)
  })
})

describe("freezing a draw for review", () => {
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
      INSERT INTO project_budget_applications (id, project_id, source_system, application_number, status, contract_sum_to_date, deposit_applied_mode, created_at, updated_at)
        VALUES ('app', 'p1', 'compass_contract_budget', '3', 'draft', 10000, 'manual', '${NOW}', '${NOW}');
      INSERT INTO project_budget_lines (id, project_id, application_id, source_system, cost_code, csi_division, csi_division_name, description, adjusted_estimate, current_work_completed, current_costs, total_costs, created_at, updated_at)
        VALUES ('line', 'p1', 'app', 'compass_contract_budget', '03 30 00', '03', 'Concrete', 'Footings', 10000, 1000, 1000, 1000, '${NOW}', '${NOW}');
      INSERT INTO project_operations (id, project_id, source_system, source_record_type, source_record_id, source_record_number, title, status, created_at, updated_at)
        VALUES ('op', 'p1', 'compass', 'owner_pay_application', 'app', '3', 'Owner pay application 3', 'draft', '${NOW}', '${NOW}');
    `)
  })
  afterEach(() => sqlite.close())

  /** The database, with `hook` run once just before the next batch (a write landing mid-request). */
  function dbWithHook(hook: () => void) {
    const db = drizzleOverSqlite(sqlite)
    let pending: (() => void) | null = hook
    return new Proxy(db, {
      get(target, property) {
        if (property !== "batch") return Reflect.get(target, property)
        return (...args: Parameters<typeof db.batch>) => {
          pending?.()
          pending = null
          return target.batch(...args)
        }
      },
    })
  }

  it("moves, recomputes totals and stages the Sage review snapshot in one go", async () => {
    await sendPayApplicationForReview(drizzleOverSqlite(sqlite), { projectId: "p1", applicationId: "app", now: "2026-11-13T00:00:00.000Z" })
    expect(sqlite.prepare("SELECT status, current_payment_due AS due FROM project_budget_applications").get()).toEqual({ status: "internal_review", due: 1000 })
    const operation = sqlite.prepare("SELECT status, amount, sage_payload_json AS payload FROM project_operations").get()
    expect(operation).toMatchObject({ status: "internal_review", amount: 1000 })
    expect(JSON.parse(String(Reflect.get(Object(operation), "payload"))).g702.currentPaymentDue).toBe(1000)
  })

  it("is refused, changing nothing, when a line is edited while it runs", async () => {
    const db = dbWithHook(() => sqlite.exec("UPDATE project_budget_lines SET current_work_completed = 2000, total_costs = 2000, updated_at = 'later'"))
    await expect(sendPayApplicationForReview(db, { projectId: "p1", applicationId: "app", now: "2026-11-13T00:00:00.000Z" })).rejects.toThrow(/changed/)
    expect(sqlite.prepare("SELECT status FROM project_budget_applications").get()).toEqual({ status: "draft" })
    expect(sqlite.prepare("SELECT status, sage_payload_json AS payload FROM project_operations").get()).toEqual({ status: "draft", payload: null })
  })

  it("checks the amount due on the recomputed totals", async () => {
    sqlite.exec("UPDATE project_budget_applications SET current_payment_due = 500")
    sqlite.exec("UPDATE project_budget_lines SET current_work_completed = 0, current_costs = 0, total_costs = 0")
    await expect(sendPayApplicationForReview(drizzleOverSqlite(sqlite), { projectId: "p1", applicationId: "app", now: NOW })).rejects.toThrow(/Enter current work/)
  })

  it("a refresh never rewrites the totals of a draw that went to review", async () => {
    sqlite.exec("UPDATE project_budget_applications SET status = 'internal_review', current_payment_due = 1000")
    sqlite.exec("UPDATE project_budget_lines SET total_costs = 4000")
    expect(await refreshOwnerPayApplication(drizzleOverSqlite(sqlite), "p1", "app", NOW)).toBe(false)
    expect(sqlite.prepare("SELECT current_payment_due AS due FROM project_budget_applications").get()).toEqual({ due: 1000 })
  })
})

// ---------------------------------------------------------------------------
// Guard: project_budget_applications status writes go through the budget store.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("pay application status write guard", { timeout: 30_000 }, () => {
  it("only the budget store updates or inserts project_budget_applications", () => {
    const writers = sourceFiles("src")
      .filter((file) => /\.(update|insert)\((schema\.)?projectBudgetApplications\)|(UPDATE|INSERT INTO)\s+project_budget_applications/i.test(readFileSync(file, "utf8")))
    expect(writers).toEqual(["src/lib/domain/budget/store.ts"])
  })

  it("the store's status moves are compare-and-set and read the machine", () => {
    const store = readFileSync("src/lib/domain/budget/store.ts", "utf8")
    const move = store.slice(store.indexOf("export async function movePayApplicationStatus"))
    const body = move.slice(0, move.indexOf("\n}\n"))
    expect(body).toContain("payApplicationMachine.transitions[input.event]")
    expect(body).toContain("compassDrawIn(input.projectId, input.applicationId, rule.from)")
    expect(body).toContain("batchGuardStatement(")
    // Every other status literal the store writes belongs to a contract budget projection.
    const statusWrites = [...store.matchAll(/status: "([a-z_]+)"/g)].map((match) => match[1])
    expect(new Set(statusWrites)).toEqual(new Set(["budget_superseded", "budget_current"]))
  })
})
