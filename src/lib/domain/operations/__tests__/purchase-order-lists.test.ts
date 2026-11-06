import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

import { loadAllJobsPurchaseOrders } from "../purchase-order-lists"

const STAMP = "2026-11-01T00:00:00.000Z"

function seededDb(): ReturnType<typeof getDb> {
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
  const po = (id: string, project: string, status: string): string =>
    `('${id}','${project}','compass','purchase_order','${id.toUpperCase()}','${id} title','${status}','${STAMP}','${STAMP}')`
  sqlite.exec(`
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,source_record_number,title,status,created_at,updated_at) VALUES
      ${po("a1", "job-a", "draft")},
      ${po("b1", "job-b", "Partially-Received")},
      ${po("a2", "job-a", "voided")},
      ${po("b2", "job-b", "archived")},
      ${po("a3", "job-a", "complete")},
      ${po("x1", "job-x", "draft")};
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,title,status,created_at,updated_at) VALUES
      ('todo','job-a','compass','task','A to-do','open','${STAMP}','${STAMP}');
  `)
  return getDb(d1(sqlite))
}

describe("every job's purchase orders", () => {
  it("lists the company's open POs across jobs, with counts for every status", async () => {
    const db = seededDb()
    const open = await loadAllJobsPurchaseOrders(db, "org", "open")
    expect(open.rows.map((row) => row.id).sort()).toEqual(["a1", "b1"])
    expect(open.rows.find((row) => row.id === "b1")).toMatchObject({ projectName: "Job B", number: "B1" })
    expect(open.statusCounts.reduce((total, row) => total + row.count, 0)).toBe(5)
  })

  it("filters by one status, whatever its stored spelling", async () => {
    const db = seededDb()
    expect((await loadAllJobsPurchaseOrders(db, "org", "void")).rows.map((row) => row.id)).toEqual(["a2"])
    expect((await loadAllJobsPurchaseOrders(db, "org", "closed")).rows.map((row) => row.id)).toEqual(["b2"])
    expect((await loadAllJobsPurchaseOrders(db, "org", "received")).rows).toEqual([])
    expect((await loadAllJobsPurchaseOrders(db, "org", "all")).rows).toHaveLength(5)
  })
})
