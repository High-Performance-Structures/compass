import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

import { savePriorityReorder } from "../priority-commands"
import { loadPriorityOrderRows, loadPurchaseOrderQueue } from "../priority-queries"
import { applyPriorityRankUpdates, rankUnrankedOperations } from "../store"
import type { PriorityOrderScope } from "../types"

const STAMP = "2026-11-01T00:00:00.000Z"
const PO = "purchase_order"

function seed(): Sqlite {
  const sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES
      ('org','Example','example','internal',1,'${STAMP}','${STAMP}'),
      ('other','Other','other','internal',1,'${STAMP}','${STAMP}');
    INSERT INTO project_job_statuses (id,organization_id,label,created_at,updated_at) VALUES
      ('custom-archive','org','Archived','${STAMP}','${STAMP}');
    INSERT INTO projects (id,name,organization_id,department,job_status_id,created_at,updated_at) VALUES
      ('job-a','Job A','org','O','current','${STAMP}','${STAMP}'),
      ('job-b','Job B','org','O','current','${STAMP}','${STAMP}'),
      ('job-old','Old Job','org','O','custom-archive','${STAMP}','${STAMP}'),
      ('job-done','Done Job','org','O','complete','${STAMP}','${STAMP}'),
      ('job-x','Job X','other','O','current','${STAMP}','${STAMP}');
  `)
  const po = (id: string, project: string, status: string, created: string, rank: number | null = null): string =>
    `('${id}','${project}','compass','purchase_order','${id.toUpperCase()}','${id} title','${status}',${rank ?? "NULL"},'${created}','${created}')`
  sqlite.exec(`
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,source_record_number,title,status,priority_rank,created_at,updated_at) VALUES
      ${po("a1", "job-a", "draft", "2026-10-01T00:00:00.000Z")},
      ${po("b1", "job-b", "sent", "2026-10-02T00:00:00.000Z")},
      ${po("a2", "job-a", "approved", "2026-10-03T00:00:00.000Z")},
      ${po("a3", "job-a", "Partially-Received", "2026-10-04T00:00:00.000Z")},
      ${po("b2", "job-b", "ordered", "2026-10-05T00:00:00.000Z")},
      ${po("b3", "job-b", "voided", "2026-10-05T00:00:00.000Z")},
      ${po("b4", "job-b", "archived", "2026-10-05T00:00:00.000Z")},
      ${po("old1", "job-old", "draft", "2026-10-01T00:00:00.000Z")},
      ${po("done1", "job-done", "draft", "2026-10-01T00:00:00.000Z")},
      ${po("x1", "job-x", "draft", "2026-10-01T00:00:00.000Z", 1)};
  `)
  return sqlite
}

const queueIds = async (db: ReturnType<typeof getDb>): Promise<string[]> =>
  (await loadPurchaseOrderQueue(db, "org")).map((row) => row.id)

const ranks = (sqlite: Sqlite): Record<string, unknown> =>
  Object.fromEntries(
    sqlite.prepare("SELECT id, priority_rank FROM project_operations ORDER BY id").all().map((row) => [row.id, row.priority_rank]),
  )

function move(db: ReturnType<typeof getDb>, scope: PriorityOrderScope, previousIds: string[], orderedIds: string[]) {
  return savePriorityReorder(db, { organizationId: "org", recordType: PO, scope, previousIds, orderedIds })
}

describe("ordering priority reads and writes", () => {
  it("queues only POs still to be ordered, on open jobs, oldest first until ranked", async () => {
    const db = getDb(d1(seed()))
    // Excludes ordered, Partially-Received, voided and archived POs, and the
    // archived and complete jobs.
    expect(await queueIds(db)).toEqual(["a1", "b1", "a2"])
    const [, second] = await loadPurchaseOrderQueue(db, "org")
    expect(second).toMatchObject({ projectId: "job-b", projectName: "Job B", number: "B1", status: "sent" })
  })

  it("a job's move of unranked POs keeps other jobs' older POs in place", async () => {
    const sqlite = seed()
    const db = getDb(d1(sqlite))
    // Job A shows a1, a2 (a3 is received). Move a2 above a1.
    expect(await move(db, { kind: "project", projectId: "job-a" }, ["a1", "a2"], ["a2", "a1"]))
      .toMatchObject({ kind: "saved", changed: 2, projectIds: ["job-a"] })
    // b1 (job B, older than a2) stays second.
    expect(await queueIds(db)).toEqual(["a2", "b1", "a1"])
    // Every unranked PO of the company got a rank in its old order; the
    // other company's rank is untouched.
    expect(ranks(sqlite)).toMatchObject({ x1: 1 })
    expect(Object.entries(ranks(sqlite)).filter(([, rank]) => rank === null)).toEqual([])
  })

  it("moves only the span sent and keeps rows outside it in place", async () => {
    const db = getDb(d1(seed()))
    await rankUnrankedOperations(db, { organizationId: "org", recordType: PO })
    // Queue a1, b1, a2: move a2 to the top. The span is all three.
    expect((await move(db, { kind: "organization" }, ["a1", "b1", "a2"], ["a2", "a1", "b1"])).kind).toBe("saved")
    expect(await queueIds(db)).toEqual(["a2", "a1", "b1"])
    // Then swap only a1 and b1.
    expect((await move(db, { kind: "organization" }, ["a1", "b1"], ["b1", "a1"])).kind).toBe("saved")
    expect(await queueIds(db)).toEqual(["a2", "b1", "a1"])
  })

  it("reports stale and writes nothing when the order changed meanwhile", async () => {
    const sqlite = seed()
    const db = getDb(d1(sqlite))
    await rankUnrankedOperations(db, { organizationId: "org", recordType: PO })
    const before = ranks(sqlite)
    // The person saw b1 above a1, but a1 is above b1 now.
    expect(await move(db, { kind: "organization" }, ["b1", "a1"], ["a1", "b1"])).toEqual({ kind: "stale" })
    expect(ranks(sqlite)).toEqual(before)
  })

  it("writes all of a plan or none of it", async () => {
    const sqlite = seed()
    const db = getDb(d1(sqlite))
    await rankUnrankedOperations(db, { organizationId: "org", recordType: PO })
    const before = ranks(sqlite)
    // a1's rank is no longer 99, so neither row changes.
    expect(await applyPriorityRankUpdates(db, {
      organizationId: "org",
      recordType: PO,
      updates: [{ id: "a1", previousRank: 99, nextRank: 2 }, { id: "b1", previousRank: 2, nextRank: 1 }],
    })).toBe(0)
    expect(ranks(sqlite)).toEqual(before)
  })

  it("never reaches another company's or another job's rows", async () => {
    const sqlite = seed()
    const db = getDb(d1(sqlite))
    const rows = await loadPriorityOrderRows(db, {
      organizationId: "org",
      recordType: PO,
      scope: { kind: "project", projectId: "job-a" },
      ids: ["a1", "b1", "x1"],
    })
    expect(rows.map((row) => row.id)).toEqual(["a1"])
    // A forged write for another company's row changes nothing.
    expect(await applyPriorityRankUpdates(db, {
      organizationId: "org",
      recordType: PO,
      updates: [{ id: "x1", previousRank: 1, nextRank: 9 }],
    })).toBe(0)
    expect(ranks(sqlite)).toMatchObject({ x1: 1 })
    // A job-scoped move naming another job's PO is stale.
    expect(await move(db, { kind: "project", projectId: "job-a" }, ["a1", "b1"], ["b1", "a1"])).toEqual({ kind: "stale" })
  })
})
