import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Every change-order execution runs the same follow-up step
 * (afterChangeOrdersExecuted): a replacement selection's change order,
 * executed through a signed change-order estimate delivered by the Foxit
 * webhook, approves the replacement and adds its "Order" to-do. Also checks
 * that every execution path calls the shared step.
 */

const mocks = vi.hoisted(() => ({ db: { current: null as unknown } }))
vi.mock("@/db", async (original) => {
  const actual = await original<typeof import("@/db")>()
  // The webhook's database is the test's; the test helper builds it with the real getDb.
  return { ...actual, getDb: (d1: D1Database) => mocks.db.current ?? actual.getDb(d1) }
})
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {}, FOXIT_ESIGN_WEBHOOK_SECRET: "secret" } }) }))
vi.mock("@/lib/foxit/esign", () => ({ verifyFoxitWebhook: async () => true }))
vi.mock("@/lib/esign/announce", () => ({ announceEsignOutcome: vi.fn() }))
vi.mock("@/lib/financials/contract-budget-store", () => ({ rebuildProjectContractBudget: vi.fn(async () => ({ success: true })) }))
vi.mock("@/lib/sage/estimate-sync", () => ({ queueEstimateSageSync: vi.fn(), sageExportActor: vi.fn() }))
vi.mock("@/lib/change-orders/estimate-execution", async (original) => {
  const actual = await original<typeof import("@/lib/change-orders/estimate-execution")>()
  const { updateChangeOrdersStatement } = await import("@/lib/domain/estimates/store")
  const { projectChangeOrders } = await import("@/db/schema-change-orders")
  return {
    ...actual,
    // The real one prices lines from the estimate; here the change order just executes.
    changeOrderExecutionFromEstimate: async (input: { db: Parameters<typeof updateChangeOrdersStatement>[0]; estimate: { changeOrderId: string }; now: string }) => [
      updateChangeOrdersStatement(input.db, eq(projectChangeOrders.id, input.estimate.changeOrderId), { status: "executed", executedAt: input.now, updatedAt: input.now }),
    ],
  }
})

import { POST } from "@/app/api/integrations/foxit/webhook/route"

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

/** A row in `table` with the given values; other required columns get placeholders. */
function insertFilled(db: Sqlite, table: string, given: Readonly<Record<string, string | number>>): void {
  const values = new Map(Object.entries(given))
  for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (typeof column !== "object" || column === null) continue
    const name = String(Reflect.get(column, "name"))
    const required = Reflect.get(column, "notnull") === 1 && Reflect.get(column, "dflt_value") === null && Reflect.get(column, "pk") === 0
    if (!required || values.has(name)) continue
    const type = String(Reflect.get(column, "type")).toLowerCase()
    values.set(name, type.includes("int") || type.includes("real") ? 0 : name.endsWith("_at") ? NOW : "x")
  }
  const names = [...values.keys()]
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((name) => values.get(name)))
}

beforeEach(() => {
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_number, created_at) VALUES ('p1', 'Job', 'org-1', 'O-1', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, status, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'installed', '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, status, replaces_selection_id, replacement_reason, created_at, updated_at) VALUES
      ('new-tile', 'p1', 'Kitchen', 'Backsplash', 'proposed', 'tile', 'installed_replaced', '${NOW}', '${NOW}');
    INSERT INTO project_selection_choices (id, project_id, selection_id, title, chosen, created_at, updated_at) VALUES ('subway', 'p1', 'new-tile', 'Subway', 1, '${NOW}', '${NOW}');
    UPDATE project_finish_selections SET replacement_priced_choice_id = 'subway' WHERE id = 'new-tile';
    INSERT INTO project_change_orders (id, project_id, change_order_number, title, scope, status, audience, requester_type, requester_name, source_type, source_record_id, created_at, updated_at)
      VALUES ('co-r', 'p1', 'O-1-CO1', 'Installed item replaced', 'Replace', 'signature_pending', 'owner', 'internal', 'Pat PM', 'selection_replacement', 'new-tile', '${NOW}', '${NOW}');
  `)
  insertFilled(sqlite, "project_estimates", {
    id: "est-co",
    project_id: "p1",
    status: "signature_pending",
    change_order_id: "co-r",
    foxit_envelope_id: "env-co",
    created_by: "staff",
    version_number: 1,
  })
  mocks.db.current = null
  mocks.db.current = drizzleOverSqlite(sqlite)
})
afterEach(() => {
  mocks.db.current = null
  sqlite.close()
})

function webhook(event: string): Request {
  return new Request("https://compass.example.com/api/integrations/foxit/webhook?signature=abc", {
    method: "POST",
    body: JSON.stringify({ event_name: event, folderId: "env-co" }),
  })
}

describe("change order executed follow-up", () => {
  it("a replacement change order signed through Foxit approves the replacement and adds its Order to-do", async () => {
    const response = await POST(webhook("folder_executed"))
    expect(await response.json()).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status FROM project_change_orders WHERE id = 'co-r'").get()).toEqual({ status: "executed" })
    expect(sqlite.prepare("SELECT status, owner_approved FROM project_finish_selections WHERE id = 'new-tile'").get()).toEqual({ status: "approved", owner_approved: 1 })
    expect(sqlite.prepare("SELECT status FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "installed" })
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM project_operations WHERE source_record_id = 'new-tile' AND json_extract(sage_payload_json, '$.selectionStep') = 'order'").get(),
    ).toEqual({ n: 1 })
  })

  it("every change-order execution path runs the shared follow-up", () => {
    const callers = [
      "src/app/api/integrations/foxit/webhook/route.ts",
      "src/lib/domain/estimates/acceptance.ts",
      "src/lib/domain/estimates/change-order-acceptance.ts",
      "src/lib/change-orders/rebaseline-store.ts",
      "src/app/actions/project-change-orders.ts",
      "src/lib/domain/estimates/variances.ts",
      "src/lib/domain/selections/round-signing.ts",
    ]
    for (const file of callers) expect(readFileSync(file, "utf8"), file).toContain("afterChangeOrdersExecuted(")
  })
})
