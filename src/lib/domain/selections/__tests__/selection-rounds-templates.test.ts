import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Selection rounds (cards, assignment, the one-time "ready to finalize"
 * alert) and the company choice-template library (save, apply, CSV import),
 * against a database built from every migration.
 */

const mocks = vi.hoisted(() => ({ staff: vi.fn(), audience: vi.fn(), notify: vi.fn() }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/notifications/events", () => ({ notifyProjectStaffOfOutsideEvent: mocks.notify }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getSelectionSheet, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import {
  applyChoiceTemplate,
  assignSelectionRound,
  deleteChoiceTemplate,
  getChoiceTemplates,
  importChoiceTemplatesCsv,
  saveSelectionAsTemplate,
} from "@/app/actions/selection-templates"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
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
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

function seed(db: Sqlite): void {
  db.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_manager, created_at) VALUES ('p1', 'Job', 'org-1', 'Pat PM', '${NOW}');
    INSERT INTO vendors (id, name, organization_id, created_at, updated_at) VALUES ('v1', 'Tile Supply', 'org-1', '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, category, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'Tile', '${NOW}', '${NOW}'),
      ('floor', 'p1', 'Bath', 'Floor tile', 'Tile', '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Kitchen', 'Faucet', 'Plumbing', '${NOW}', '${NOW}');
    INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, created_at, updated_at)
      VALUES ('t1', 'p1', 'Rough-in plumbing', '2026-12-25', 5, '2026-12-31', 'rough', '${NOW}', '${NOW}');
    INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'selections', '{"rounds":[{"id":"rough-in","name":"Rough-in","scheduleItem":"rough-in","bufferDays":21}],"leadTimeDays":{"Tile":14},"ownerMarkupPercent":20,"changeOrderThresholdPercent":10}', '${NOW}');
  `)
}

async function choice(selectionId: string, title: string, price?: string): Promise<string> {
  const result = await saveSelectionChoice("p1", selectionId, null, { title, price })
  if (!result.success) throw new Error(result.error)
  return result.data.id
}

beforeEach(() => {
  sqlite = migrated()
  seed(sqlite)
  const db = drizzleOverSqlite(sqlite)
  mocks.staff.mockResolvedValue({ db, user: { id: "staff" }, organizationId: "org-1" })
  mocks.notify.mockResolvedValue(undefined)
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("rounds", () => {
  it("shows round cards and alerts staff once when every selection in the round has a pick", async () => {
    expect(await assignSelectionRound("p1", ["tile", "faucet"], "rough-in")).toMatchObject({ success: true, data: { count: 2 } })
    expect(await assignSelectionRound("p1", ["floor"], "made-up")).toMatchObject({ success: false })

    const tileChoice = await choice("tile", "Zellige", "100")
    const faucetChoice = await choice("faucet", "Brass")
    let sheet = await getSelectionSheet("p1")
    expect(sheet.rounds).toEqual([
      { key: "rough-in", name: "Rough-in", dueDate: "2026-12-04", alerted: false, total: 2, chosen: 0, deltaCents: 0, ready: false },
    ])

    await setSelectionChoiceChosen("p1", tileChoice, true)
    expect(mocks.notify).not.toHaveBeenCalled()
    await setSelectionChoiceChosen("p1", faucetChoice, true)
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify.mock.calls[0]?.[0]).toMatchObject({ projectId: "p1", eventType: "selection_round_ready", title: "Rough-in selections ready to finalize" })
    sheet = await getSelectionSheet("p1")
    expect(sheet.rounds[0]).toMatchObject({ chosen: 2, ready: true, alerted: true })

    // Picking again doesn't repeat it; clearing a pick and finishing again does.
    await setSelectionChoiceChosen("p1", faucetChoice, true)
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    await setSelectionChoiceChosen("p1", faucetChoice, false)
    expect((await getSelectionSheet("p1")).rounds[0]).toMatchObject({ ready: false, alerted: false })
    await setSelectionChoiceChosen("p1", faucetChoice, true)
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })
})

describe("choice templates", () => {
  it("prefills owner price and lead time from Settings on a new choice", async () => {
    await choice("tile", "Zellige", "100")
    const row = sqlite.prepare("SELECT owner_price_cents, lead_time_days FROM project_selection_choices").get()
    expect(row).toEqual({ owner_price_cents: 12000, lead_time_days: 14 })
  })

  it("saves a selection's choices as a template and applies it to one selection or the job's category", async () => {
    await choice("tile", "Zellige", "100")
    await choice("tile", "Subway")
    expect(await saveSelectionAsTemplate("p1", "tile", "Kitchen tile")).toMatchObject({ success: true, data: { count: 2 } })
    expect(await saveSelectionAsTemplate("p1", "faucet", "Empty")).toMatchObject({ success: false })
    const templates = await getChoiceTemplates("p1")
    const template = templates.success ? templates.data[0] : undefined
    expect(template).toMatchObject({ name: "Kitchen tile", category: "Tile", itemCount: 2 })
    if (!template) throw new Error("no template")

    expect(await applyChoiceTemplate("p1", template.id, { kind: "selection", selectionId: "floor" })).toMatchObject({ success: true, data: { count: 2 } })
    expect(sqlite.prepare("SELECT title, sort_order, source_system FROM project_selection_choices WHERE selection_id = 'floor' ORDER BY sort_order").all()).toEqual([
      { title: "Zellige", sort_order: 0, source_system: "compass_template" },
      { title: "Subway", sort_order: 1, source_system: "compass_template" },
    ])
    // Category: both Tile selections get the choices; Plumbing does not.
    expect(await applyChoiceTemplate("p1", template.id, { kind: "category" })).toMatchObject({ success: true, data: { count: 4 } })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id = 'faucet'").get()).toEqual({ n: 0 })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id = 'floor'").get()).toEqual({ n: 4 })

    expect(await deleteChoiceTemplate("p1", template.id)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT count(*) AS n FROM selection_choice_template_items").get()).toEqual({ n: 0 })
  })

  it("imports templates from CSV, links known suppliers, and replaces a template on re-import", async () => {
    const csv = [
      "Template,Category,Title,Supplier,Supplier price,Product URL",
      "Kitchen tile,Tile,Zellige,Tile Supply,100,https://tile.example.com/z",
      "Kitchen tile,Tile,Subway,Local Yard,80,",
      "Faucets,Plumbing,Brass,,,",
    ].join("\n")
    const first = await importChoiceTemplatesCsv("p1", csv)
    expect(first).toMatchObject({ success: true, data: { templates: 2, choices: 3, errors: [] } })
    expect(sqlite.prepare("SELECT title, vendor_id, supplier_name FROM selection_choice_template_items ORDER BY title").all()).toEqual([
      { title: "Brass", vendor_id: null, supplier_name: null },
      { title: "Subway", vendor_id: null, supplier_name: "Local Yard" },
      { title: "Zellige", vendor_id: "v1", supplier_name: null },
    ])

    const again = await importChoiceTemplatesCsv("p1", "Template,Title\nKitchen tile,Hex")
    expect(again).toMatchObject({ success: true, data: { templates: 1, choices: 1 } })
    expect(sqlite.prepare("SELECT count(*) AS n FROM selection_choice_templates").get()).toEqual({ n: 2 })
    expect(sqlite.prepare("SELECT t.name, i.title FROM selection_choice_template_items i JOIN selection_choice_templates t ON t.id = i.template_id WHERE t.name = 'Kitchen tile'").all()).toEqual([
      { name: "Kitchen tile", title: "Hex" },
    ])

    const templates = await getChoiceTemplates("p1")
    const faucets = templates.success ? templates.data.find((item) => item.name === "Faucets") : undefined
    if (!faucets) throw new Error("no template")
    await applyChoiceTemplate("p1", faucets.id, { kind: "selection", selectionId: "faucet" })
    expect(sqlite.prepare("SELECT title FROM project_selection_choices WHERE selection_id = 'faucet'").all()).toEqual([{ title: "Brass" }])
    // An unpriced choice from a template asks for pricing, as one added by hand does.
    expect(sqlite.prepare("SELECT title FROM project_operations WHERE source_record_id = 'faucet'").all()).toEqual([{ title: "Price choices for Faucet" }])
  })
})
