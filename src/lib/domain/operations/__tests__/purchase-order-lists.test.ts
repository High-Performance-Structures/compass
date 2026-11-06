import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

import { ALL_JOBS_PURCHASE_ORDER_LIMIT, loadAllJobsPurchaseOrders } from "../purchase-order-lists"

const STAMP = "2026-11-01T00:00:00.000Z"

function seededDb(extra = ""): ReturnType<typeof getDb> {
  const sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES
      ('org','Example','example','internal',1,'${STAMP}','${STAMP}'),
      ('other','Other','other','internal',1,'${STAMP}','${STAMP}');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES
      ('job-a','Job A','org','O','${STAMP}','${STAMP}'),
      ('job-b','Job B','org','O','${STAMP}','${STAMP}'),
      ('job-gone','Removed Job','org','O','${STAMP}','${STAMP}'),
      ('job-x','Job X','other','O','${STAMP}','${STAMP}');
    INSERT INTO project_registry_removals (id,organization_id,project_id,original_status,project_snapshot_json,removed_at,created_at,updated_at)
      VALUES ('removal','org','job-gone','OPEN','{}','${STAMP}','${STAMP}','${STAMP}');
  `)
  const po = (id: string, project: string, status: string): string =>
    `('${id}','${project}','compass','purchase_order','${id.toUpperCase()}','${id} title','${status}','${STAMP}','${STAMP}')`
  sqlite.exec(`
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,source_record_number,title,status,created_at,updated_at) VALUES
      ${po("a1", "job-a", "draft")},
      ${po("b1", "job-b", "Partially-Received")},
      ${po("a2", "job-a", "voided")},
      ${po("b2", "job-b", "archived")},
      ${po("a3", "job-a", "complete")},
      ${po("x1", "job-x", "draft")},
      ${po("gone1", "job-gone", "draft")};
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,title,status,created_at,updated_at) VALUES
      ('todo','job-a','compass','task','A to-do','open','${STAMP}','${STAMP}');
  `)
  if (extra) sqlite.exec(extra)
  return getDb(d1(sqlite))
}

describe("every job's purchase orders", () => {
  it("lists the company's open POs across jobs, with counts for every status", async () => {
    const db = seededDb()
    const open = await loadAllJobsPurchaseOrders(db, "org", "open")
    expect(open.rows.map((row) => row.id).sort()).toEqual(["a1", "b1"])
    expect(open.rows.find((row) => row.id === "b1")).toMatchObject({ projectName: "Job B", number: "B1" })
    // The removed project's PO is in neither the rows nor the counts.
    expect(open.statusCounts.reduce((total, row) => total + row.count, 0)).toBe(5)
    expect(open.truncated).toBe(false)
  })

  it("loads at most the limit and says so, sending only a description preview", async () => {
    const db = seededDb(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ALL_JOBS_PURCHASE_ORDER_LIMIT})
      INSERT INTO project_operations (id,project_id,source_system,source_record_type,title,description,status,created_at,updated_at)
      SELECT 'bulk-' || i, 'job-a', 'compass', 'purchase_order', 'Bulk', printf('%.500c', 'x'), 'draft', '${STAMP}', '${STAMP}' FROM n;
    `)
    const open = await loadAllJobsPurchaseOrders(db, "org", "open")
    expect(open.rows).toHaveLength(ALL_JOBS_PURCHASE_ORDER_LIMIT)
    expect(open.truncated).toBe(true)
    expect(open.rows.find((row) => row.id === "bulk-1")?.description?.length).toBe(200)
  })

  it("filters by one status, whatever its stored spelling", async () => {
    const db = seededDb()
    expect((await loadAllJobsPurchaseOrders(db, "org", "void")).rows.map((row) => row.id)).toEqual(["a2"])
    expect((await loadAllJobsPurchaseOrders(db, "org", "closed")).rows.map((row) => row.id)).toEqual(["b2"])
    expect((await loadAllJobsPurchaseOrders(db, "org", "received")).rows).toEqual([])
    expect((await loadAllJobsPurchaseOrders(db, "org", "all")).rows).toHaveLength(5)
  })
})
