import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

import { defaultRecordStatusList, type RecordStatusEdit } from "../rules"
import { countRecordsWithStatus, deleteRecordStatus, loadAllRecordStatusLists, loadRecordStatusList, saveRecordStatusList } from "../store"

const STAMP = "2026-11-05T00:00:00.000Z"

function seeded(): { readonly sqlite: Sqlite; readonly db: ReturnType<typeof getDb> } {
  const sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES
      ('org-a','Company A','company-a','internal',1,'${STAMP}','${STAMP}'),
      ('org-b','Company B','company-b','internal',1,'${STAMP}','${STAMP}');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES
      ('job-a','Job A','org-a','O','${STAMP}','${STAMP}'),
      ('job-b','Job B','org-b','O','${STAMP}','${STAMP}');
  `)
  return { sqlite, db: getDb(d1(sqlite)) }
}

function poEdits(extra: readonly RecordStatusEdit[] = []): RecordStatusEdit[] {
  return [
    ...defaultRecordStatusList("purchase_order").statuses.map((status) => ({
      key: status.key,
      label: status.label,
      color: status.color,
      group: status.group,
      showAsButton: status.showAsButton,
      hidden: status.hidden,
    })),
    ...extra,
  ]
}

const BACKORDERED: RecordStatusEdit = { key: null, label: "Backordered", color: "orange", group: "open", showAsButton: true, hidden: false }

function addPurchaseOrder(sqlite: Sqlite, id: string, project: string, status: string): void {
  sqlite.exec(`
    INSERT INTO project_operations (id,project_id,source_system,source_record_type,title,status,created_at,updated_at)
    VALUES ('${id}','${project}','compass','purchase_order','${id}','${status}','${STAMP}','${STAMP}');
  `)
}

describe("record status store", () => {
  it("reads the code defaults until a company saves, then its own list", async () => {
    const { db } = seeded()
    expect(await loadRecordStatusList(db, "org-a", "purchase_order")).toEqual(defaultRecordStatusList("purchase_order"))
    const renamed = poEdits([BACKORDERED]).map((edit) => (edit.key === "sent" ? { ...edit, label: "Emailed" } : edit))
    const saved = await saveRecordStatusList(db, "org-a", "purchase_order", renamed, STAMP)
    expect(saved.ok).toBe(true)
    const list = await loadRecordStatusList(db, "org-a", "purchase_order")
    expect(list.statuses.find((status) => status.key === "sent")?.label).toBe("Emailed")
    expect(list.statuses.at(-1)).toMatchObject({ key: "backordered", builtIn: false })
    // Saving again keeps the new status's key.
    const again = list.statuses.map((status) => ({ key: status.key, label: status.label, color: status.color, group: status.group, showAsButton: status.showAsButton, hidden: status.hidden }))
    expect((await saveRecordStatusList(db, "org-a", "purchase_order", again, STAMP)).ok).toBe(true)
    expect((await loadRecordStatusList(db, "org-a", "purchase_order")).statuses.map((status) => status.key)).toEqual(list.statuses.map((status) => status.key))
    // Other companies and record types are untouched.
    expect(await loadRecordStatusList(db, "org-b", "purchase_order")).toEqual(defaultRecordStatusList("purchase_order"))
    const all = await loadAllRecordStatusLists(db, "org-a")
    expect(all.find((item) => item.type === "rfi")).toEqual(defaultRecordStatusList("rfi"))
  })

  it("refuses to delete a built-in status, by Delete or by leaving it out of a save", async () => {
    const { sqlite, db } = seeded()
    expect((await saveRecordStatusList(db, "org-a", "purchase_order", poEdits(), STAMP)).ok).toBe(true)
    const deleted = await deleteRecordStatus(db, "org-a", "purchase_order", "draft")
    expect(deleted).toEqual({ ok: false, error: expect.stringContaining("built-in status") })
    const dropped = await saveRecordStatusList(db, "org-a", "purchase_order", poEdits().filter((edit) => edit.key !== "draft"), STAMP)
    expect(dropped.ok).toBe(false)
    const draftRows = sqlite.prepare("SELECT COUNT(*) AS n FROM organization_record_statuses WHERE organization_id = 'org-a' AND status_key = 'draft'").all()
    expect(draftRows[0]?.n).toBe(1)
  })

  it("refuses to delete a company status records use, and deletes it once unused", async () => {
    const { sqlite, db } = seeded()
    await saveRecordStatusList(db, "org-a", "purchase_order", poEdits([BACKORDERED]), STAMP)
    addPurchaseOrder(sqlite, "po-1", "job-a", "Backordered")
    expect(await countRecordsWithStatus(db, "org-a", "purchase_order", "backordered")).toBe(1)
    const refused = await deleteRecordStatus(db, "org-a", "purchase_order", "backordered")
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("Hide it instead") })
    expect((await loadRecordStatusList(db, "org-a", "purchase_order")).statuses.some((status) => status.key === "backordered")).toBe(true)

    sqlite.exec("UPDATE project_operations SET status = 'received' WHERE id = 'po-1'")
    const removed = await deleteRecordStatus(db, "org-a", "purchase_order", "backordered")
    expect(removed.ok).toBe(true)
    expect((await loadRecordStatusList(db, "org-a", "purchase_order")).statuses.some((status) => status.key === "backordered")).toBe(false)
  })

  it("never reads or writes another company's statuses or records", async () => {
    const { sqlite, db } = seeded()
    await saveRecordStatusList(db, "org-b", "purchase_order", poEdits([BACKORDERED]), STAMP)
    // Company B's PO uses its status; company A has none.
    addPurchaseOrder(sqlite, "po-b", "job-b", "backordered")
    expect(await countRecordsWithStatus(db, "org-a", "purchase_order", "backordered")).toBe(0)

    // Company A cannot delete company B's status ...
    const crossDelete = await deleteRecordStatus(db, "org-a", "purchase_order", "backordered")
    expect(crossDelete).toEqual({ ok: false, error: "That status no longer exists. Refresh the page." })
    // ... nor save it into its own list by key.
    const crossSave = await saveRecordStatusList(db, "org-a", "purchase_order", poEdits([{ ...BACKORDERED, key: "backordered" }]), STAMP)
    expect(crossSave.ok).toBe(false)
    const companyB = await loadRecordStatusList(db, "org-b", "purchase_order")
    expect(companyB.statuses.find((status) => status.key === "backordered")?.label).toBe("Backordered")
    expect((await loadRecordStatusList(db, "org-a", "purchase_order")).statuses.some((status) => status.key === "backordered")).toBe(false)
  })

  it("counts RFIs and to-dos in their own tables", async () => {
    const { sqlite, db } = seeded()
    sqlite.exec(`
      INSERT INTO project_rfis (id,project_id,rfi_number,subject,question,status,submitted_at,created_at,updated_at)
      VALUES ('rfi-1','job-a','RFI-1','Subject','Question','with_engineer','${STAMP}','${STAMP}','${STAMP}');
      INSERT INTO project_operations (id,project_id,source_system,source_record_type,title,status,created_at,updated_at)
      VALUES ('todo-1','job-a','compass','staff_task','A to-do','waiting','${STAMP}','${STAMP}');
    `)
    const custom = (type: "rfi" | "todo", label: string): RecordStatusEdit[] => [
      ...defaultRecordStatusList(type).statuses.map((status) => ({ key: status.key, label: status.label, color: status.color, group: status.group, showAsButton: true, hidden: false })),
      { key: null, label, color: "blue", group: "open", showAsButton: true, hidden: false },
    ]
    await saveRecordStatusList(db, "org-a", "rfi", custom("rfi", "With engineer"), STAMP)
    await saveRecordStatusList(db, "org-a", "todo", custom("todo", "Waiting"), STAMP)
    expect(await countRecordsWithStatus(db, "org-a", "rfi", "with_engineer")).toBe(1)
    expect(await countRecordsWithStatus(db, "org-a", "todo", "waiting")).toBe(1)
    // Stored spellings count toward their status: "Open" is the RFI status New.
    expect(await countRecordsWithStatus(db, "org-a", "rfi", "new")).toBe(0)
    expect(await countRecordsWithStatus(db, "org-a", "purchase_order", "waiting")).toBe(0)
  })
})
