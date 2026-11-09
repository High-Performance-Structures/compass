import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * The selections workflow tie-ins, against a database built from every
 * migration: the Selections sheet rows, the owner's choosing view and pick,
 * to-dos made in the existing to-do framework, and pricing choices through
 * a normal RFQ whose returned prices fill the choices.
 */

const mocks = vi.hoisted(() => ({ staff: vi.fn(), audience: vi.fn(), operations: vi.fn() }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/domain/operations/access", () => ({ operationsContext: mocks.operations }))
vi.mock("@/lib/selections/link-preview", async (original) => {
  const actual = await original<typeof import("@/lib/selections/link-preview")>()
  return { ...actual, fetchLinkPreview: vi.fn(async () => actual.EMPTY_LINK_PREVIEW) }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { priceSelectionChoicesByRfq } from "@/app/actions/project-operations"
import {
  addSelectionComment,
  getOwnerChoiceBoard,
  getSelectionDetail,
  getSelectionSheet,
  saveSelectionChoice,
  setChoiceDependentSelections,
  setSelectionChoiceChosen,
} from "@/app/actions/selection-choices"
import { fillSelectionChoicePrices } from "@/lib/domain/selections/choice-rfq-server"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
let sqlite: Sqlite

// Every migration is replayed once per file; each test gets a fresh copy.
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
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

function seed(db: Sqlite): void {
  db.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_manager, created_at) VALUES ('p1', 'Job', 'org-1', 'Pat PM', '${NOW}');
    INSERT INTO vendors (id, name, email, organization_id, created_at, updated_at) VALUES ('v1', 'Tile Supply', 'quotes@tile.example.com', 'org-1', '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, status, created_at, updated_at) VALUES
      ('vanity', 'p1', 'Bath', 'Vanity', 'owner_review', '${NOW}', '${NOW}'),
      ('hardware', 'p1', 'Bath', 'Vanity hardware', 'needed', '${NOW}', '${NOW}'),
      ('tile', 'p1', 'Kitchen', 'Backsplash tile', 'needed', '${NOW}', '${NOW}');
    INSERT INTO project_selection_decisions (selection_id, project_id, revision, published, specification_json, allowance_cents, decision_due_date, last_mutation_id, updated_at)
      VALUES ('vanity', 'p1', 1, 1, '{}', 300000, '2026-12-04', 'm', '${NOW}');
  `)
}

async function choice(title: string, extra: { price?: string; ownerPrice?: string } = {}): Promise<string> {
  const result = await saveSelectionChoice("p1", "vanity", null, { title, ...extra })
  if (!result.success) throw new Error(result.error)
  return result.data.id
}

function todos(): readonly { title: string; source_record_id: string }[] {
  return sqlite
    .prepare("SELECT title, source_record_id FROM project_operations WHERE source_record_type = 'staff_task' ORDER BY created_at, rowid")
    .all()
    .flatMap((row) => (typeof row === "object" && row !== null && "title" in row && "source_record_id" in row ? [{ title: String(row.title), source_record_id: String(row.source_record_id) }] : []))
}

beforeEach(() => {
  sqlite = migrated()
  seed(sqlite)
  const db = drizzleOverSqlite(sqlite)
  const staffUser = { id: "staff", email: "pm@example.com", displayName: "Pat PM" }
  mocks.staff.mockResolvedValue({ db, user: staffUser, organizationId: "org-1" })
  mocks.operations.mockResolvedValue({ db, user: staffUser, organizationId: "org-1" })
  mocks.audience.mockResolvedValue({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("selection to-dos", () => {
  it("makes one open 'Price choices' to-do for unpriced choices, linked to the selection", async () => {
    await choice("Oak 36")
    await choice("Walnut 48")
    await choice("Priced", { price: "100" })
    expect(todos()).toEqual([{ title: "Price choices for Vanity", source_record_id: "vanity" }])
    const detail = await getSelectionDetail("p1", "vanity")
    expect(detail.success && detail.data.todos.map((todo) => [todo.title, todo.number, todo.assigneeName, todo.done])).toEqual([
      ["Price choices for Vanity", "TASK-001", "Pat PM", false],
    ])
  })

  it("makes an 'Answer owner question' to-do when the owner comments, not when staff do", async () => {
    await addSelectionComment("p1", "vanity", "Internal note", "staff")
    expect(todos()).toEqual([])
    expect(await addSelectionComment("p1", "vanity", "Can it be 48 inches?", "owner", "owner")).toMatchObject({ success: true })
    expect(await addSelectionComment("p1", "vanity", "And in oak?", "owner", "owner")).toMatchObject({ success: true })
    expect(todos()).toEqual([{ title: "Answer owner question on Vanity", source_record_id: "vanity" }])
  })
})

describe("sheet and owner view", () => {
  it("puts follow-ups under their parent and compares the pick's owner price with the allowance", async () => {
    const oak = await choice("Oak 36", { price: "2000", ownerPrice: "3,400" })
    await setChoiceDependentSelections("p1", oak, ["hardware"])
    await setSelectionChoiceChosen("p1", oak, true)
    const sheet = await getSelectionSheet("p1")
    const byId = new Map(sheet.rows.map((row) => [row.id, row]))
    expect(byId.get("vanity")).toMatchObject({ choiceCount: 1, pickTitle: "Oak 36", allowanceCents: 300000, deltaCents: 40000, followUpCount: 1 })
    expect(byId.get("hardware")).toMatchObject({ parentId: "vanity", parentName: "Vanity" })
    const ordered = [...sheet.rows].sort((a, b) => a.orderKey.localeCompare(b.orderKey)).map((row) => row.id)
    expect(ordered).toEqual(["vanity", "hardware", "tile"])
    expect(sheet.suppliers).toEqual([{ id: "v1", name: "Tile Supply", email: "quotes@tile.example.com" }])
  })

  it("shows owners published selections with owner prices only, and lets them pick until approval", async () => {
    const oak = await choice("Oak 36", { price: "2000", ownerPrice: "3400" })
    const walnut = await choice("Walnut 48", { price: "2500", ownerPrice: "2900" })
    const board = await getOwnerChoiceBoard("p1")
    expect(board.map((selection) => selection.id)).toEqual(["vanity"])
    expect(board[0]?.panel.choices.map((item) => [item.title, item.priceCents, item.ownerPriceCents])).toEqual([
      ["Oak 36", null, 340000],
      ["Walnut 48", null, 290000],
    ])

    expect(await setSelectionChoiceChosen("p1", oak, true, "owner")).toMatchObject({ success: true })
    expect(await setSelectionChoiceChosen("p1", walnut, true, "owner")).toMatchObject({ success: true })
    const picked = sqlite.prepare("SELECT title FROM project_selection_choices WHERE chosen = 1").all()
    expect(picked).toEqual([{ title: "Walnut 48" }])

    sqlite.prepare("UPDATE project_selection_decisions SET approved_at = ? WHERE selection_id = 'vanity'").run(NOW)
    expect(await setSelectionChoiceChosen("p1", oak, true, "owner")).toMatchObject({ success: false })
  })
})

describe("pricing choices through an RFQ", () => {
  it("makes an RFQ with one line per choice and fills the returned prices", async () => {
    const oak = await choice("Oak 36")
    const walnut = await choice("Walnut 48")
    const created = await priceSelectionChoicesByRfq("p1", {
      selectionId: "vanity",
      choiceIds: [walnut, oak],
      rfqId: null,
      requestedFrom: "Tile Supply",
      recipientEmail: "quotes@tile.example.com",
      responseDueDate: null,
      vendorPick: { projectContactId: null, vendorId: "v1" },
    })
    if (!created.success) throw new Error(created.error)
    const rfq = sqlite.prepare("SELECT status, vendor_id, sage_payload_json FROM project_operations WHERE id = ?").get(created.id)
    if (typeof rfq !== "object" || rfq === null || !("sage_payload_json" in rfq)) throw new Error("RFQ missing")
    expect(rfq).toMatchObject({ status: "draft", vendor_id: "v1" })
    const payload: unknown = JSON.parse(String(rfq.sage_payload_json))
    expect(payload).toMatchObject({ scopeItems: [{ lineNumber: 1, description: "Bath: Vanity - Oak 36" }, { lineNumber: 2, description: "Bath: Vanity - Walnut 48" }] })

    // The supplier answers through the price link (stored the same way as the portal and manual responses).
    const answered = { ...(typeof payload === "object" && payload !== null ? payload : {}), vendorResponse: {
      decision: "quote", amount: 3700.5, leadTime: null, validUntil: null, notes: null,
      responderUserId: "quote-link:1", responderName: "Sam", responderCompany: "Tile Supply", submittedAt: NOW,
      lines: [{ lineNumber: 1, amount: 1500.5, notes: null }, { lineNumber: 2, amount: 2200, notes: null }],
    } }
    sqlite.prepare("UPDATE project_operations SET sage_payload_json = ?, status = 'response_received' WHERE id = ?").run(JSON.stringify(answered), created.id)
    await fillSelectionChoicePrices(drizzleOverSqlite(sqlite), "p1", created.id, NOW)

    const prices = sqlite.prepare("SELECT title, price_cents, vendor_id FROM project_selection_choices ORDER BY sort_order").all()
    expect(prices).toEqual([
      { title: "Oak 36", price_cents: 150050, vendor_id: "v1" },
      { title: "Walnut 48", price_cents: 220000, vendor_id: "v1" },
    ])
    const detail = await getSelectionDetail("p1", "vanity")
    expect(detail.success && detail.data.rfqs.map((item) => item.id)).toEqual([created.id])
  })

  it("adds choices to an unsent RFQ draft after its existing lines", async () => {
    const oak = await choice("Oak 36")
    const first = await priceSelectionChoicesByRfq("p1", {
      selectionId: "vanity", choiceIds: [oak], rfqId: null, requestedFrom: null, recipientEmail: null, responseDueDate: null, vendorPick: null,
    })
    if (!first.success) throw new Error(first.error)
    const drafts = await getSelectionDetail("p1", "vanity")
    expect(drafts.success && drafts.data.draftRfqs.map((item) => item.id)).toEqual([first.id])

    const tileChoice = await saveSelectionChoice("p1", "tile", null, { title: "Zellige" })
    if (!tileChoice.success) throw new Error(tileChoice.error)
    expect(await priceSelectionChoicesByRfq("p1", {
      selectionId: "tile", choiceIds: [tileChoice.data.id], rfqId: first.id, requestedFrom: null, recipientEmail: null, responseDueDate: null, vendorPick: null,
    })).toEqual({ success: true, id: first.id })

    const row = sqlite.prepare("SELECT sage_payload_json FROM project_operations WHERE id = ?").get(first.id)
    const payload: unknown = row && typeof row === "object" && "sage_payload_json" in row ? JSON.parse(String(row.sage_payload_json)) : null
    expect(payload).toMatchObject({ scopeItems: [{ lineNumber: 1 }, { lineNumber: 2, description: "Kitchen: Backsplash tile - Zellige" }] })
    const links = sqlite.prepare("SELECT selection_id, specification_json FROM project_selection_procurement_links WHERE operation_id = ? ORDER BY selection_id").all(first.id)
    expect(links.map((link) => (link && typeof link === "object" && "specification_json" in link ? JSON.parse(String(link.specification_json)).choiceLines : null))).toEqual([
      [{ choiceId: tileChoice.data.id, lineNumber: 2 }],
      [{ choiceId: oak, lineNumber: 1 }],
    ])

    sqlite.prepare("UPDATE project_operations SET status = 'sent' WHERE id = ?").run(first.id)
    expect(await priceSelectionChoicesByRfq("p1", {
      selectionId: "vanity", choiceIds: [oak], rfqId: first.id, requestedFrom: null, recipientEmail: null, responseDueDate: null, vendorPick: null,
    })).toMatchObject({ success: false })
  })
})
