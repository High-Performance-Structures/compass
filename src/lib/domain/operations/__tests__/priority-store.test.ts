import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

import { planPriorityReorder } from "../priority-order"
import { loadMaxPriorityRank, loadPriorityOrderRows, loadPurchaseOrderQueue } from "../priority-queries"
import { applyPriorityRankUpdates } from "../store"

const STAMP = "2026-11-01T00:00:00.000Z"

/** The shared D1 stand-in, with batches read through `all()` so RETURNING rows come back as D1 returns them. */
function database(sqlite: Sqlite): ReturnType<typeof getDb> {
  const batch = async (statements: readonly { readonly all: () => Promise<unknown> }[]): Promise<unknown[]> =>
    Promise.all(statements.map((statement) => statement.all()))
  return getDb(Object.assign(d1(sqlite), { batch }))
}

function seed(): Sqlite {
  const sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES
      ('org','Example','example','internal',1,'${STAMP}','${STAMP}'),
      ('other','Other','other','internal',1,'${STAMP}','${STAMP}');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES
      ('job-a','Job A','org','O','${STAMP}','${STAMP}'),
      ('job-b','Job B','org','O','${STAMP}','${STAMP}'),
      ('job-x','Job X','other','O','${STAMP}','${STAMP}');
  `)
  const po = (id: string, project: string, status: string, created: string, rank: number | null): string =>
    `('${id}','${project}','compass','purchase_order','${id.toUpperCase()}','${id} title','${status}',${rank ?? "NULL"},'${created}','${created}')`
  sqlite.exec(`
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,source_record_number,title,status,priority_rank,created_at,updated_at) VALUES
      ${po("a1", "job-a", "draft", "2026-10-01T00:00:00.000Z", null)},
      ${po("b1", "job-b", "sent", "2026-10-02T00:00:00.000Z", null)},
      ${po("a2", "job-a", "approved", "2026-10-03T00:00:00.000Z", null)},
      ${po("a3", "job-a", "Partially Received", "2026-10-04T00:00:00.000Z", null)},
      ${po("b2", "job-b", "ordered", "2026-10-05T00:00:00.000Z", null)},
      ${po("x1", "job-x", "draft", "2026-10-01T00:00:00.000Z", 1)};
  `)
  return sqlite
}

describe("ordering priority reads and writes", () => {
  it("queues only the organization's POs still to be ordered, oldest first until ranked", async () => {
    const db = database(seed())
    const queue = await loadPurchaseOrderQueue(db, "org")
    expect(queue.map((row) => row.id)).toEqual(["a1", "b1", "a2"])
    expect(queue[1]).toMatchObject({ projectId: "job-b", projectName: "Job B", number: "B1", status: "sent" })
  })

  it("reorders one job's POs within its own slots and keeps other jobs and companies in place", async () => {
    const db = database(seed())
    // Rank the whole queue first: a1, b1, a2.
    const queueIds = (await loadPurchaseOrderQueue(db, "org")).map((row) => row.id)
    const first = planPriorityReorder({
      items: await loadPriorityOrderRows(db, { organizationId: "org", recordType: "purchase_order", scope: { kind: "organization" }, ids: queueIds }),
      previousIds: queueIds,
      orderedIds: ["a2", "a1", "b1"],
      maxRank: await loadMaxPriorityRank(db, "org", "purchase_order"),
    })
    expect(first.kind).toBe("updates")
    if (first.kind !== "updates") return
    expect(await applyPriorityRankUpdates(db, { organizationId: "org", recordType: "purchase_order", updates: first.updates }))
      .toBe(first.updates.length)
    expect((await loadPurchaseOrderQueue(db, "org")).map((row) => row.id)).toEqual(["a2", "a1", "b1"])

    // Job A's own list: a2, a1 (and its received a3). Swap a2 and a1 there.
    const jobIds = ["a2", "a1"]
    const second = planPriorityReorder({
      items: await loadPriorityOrderRows(db, { organizationId: "org", recordType: "purchase_order", scope: { kind: "project", projectId: "job-a" }, ids: jobIds }),
      previousIds: jobIds,
      orderedIds: ["a1", "a2"],
      maxRank: await loadMaxPriorityRank(db, "org", "purchase_order"),
    })
    if (second.kind !== "updates") throw new Error(second.kind)
    await applyPriorityRankUpdates(db, { organizationId: "org", recordType: "purchase_order", updates: second.updates })
    expect((await loadPurchaseOrderQueue(db, "org")).map((row) => row.id)).toEqual(["a1", "a2", "b1"])
    // The other company's rank is untouched.
    expect(await loadMaxPriorityRank(db, "other", "purchase_order")).toBe(1)
  })

  it("never reaches another company's or another job's rows", async () => {
    const db = database(seed())
    const rows = await loadPriorityOrderRows(db, {
      organizationId: "org",
      recordType: "purchase_order",
      scope: { kind: "project", projectId: "job-a" },
      ids: ["a1", "b1", "x1"],
    })
    expect(rows.map((row) => row.id)).toEqual(["a1"])
    // A forged write for another company's row changes nothing.
    expect(await applyPriorityRankUpdates(db, {
      organizationId: "org",
      recordType: "purchase_order",
      updates: [{ id: "x1", previousRank: 1, nextRank: 9 }],
    })).toBe(0)
  })

  it("skips a row whose rank changed since the plan (a concurrent reorder)", async () => {
    const db = database(seed())
    expect(await applyPriorityRankUpdates(db, {
      organizationId: "org",
      recordType: "purchase_order",
      updates: [{ id: "a1", previousRank: 4, nextRank: 1 }, { id: "b1", previousRank: null, nextRank: 2 }],
    })).toBe(1)
  })
})
