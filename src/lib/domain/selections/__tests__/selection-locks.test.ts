import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Owner decisions 2026-11-12, against a database built from every
 * migration: ordered and installed selections are locked; "Replace
 * installed item" and "Owner changed selection after purchase" make a new
 * selection (the old one kept) with a draft change order; a price change
 * while a Selection Phase is out for signature tells the job's managers.
 */

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  audience: vi.fn(),
  envelope: vi.fn(),
  announce: vi.fn(),
  notify: vi.fn(),
  notice: vi.fn(),
  systemNotice: vi.fn(),
  context: vi.fn(),
}))
vi.mock("@/lib/server/action-context", async (original) => ({ ...(await original<typeof import("@/lib/server/action-context")>()), projectContext: mocks.context }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/foxit/esign", () => ({ createFoxitPreparedEnvelope: mocks.envelope, downloadFoxitExecutedEnvelope: vi.fn() }))
vi.mock("@/lib/esign/announce", () => ({ announceEsignOutcome: mocks.announce }))
vi.mock("@/lib/notifications/events", () => ({
  notifyProjectStaffOfOutsideEvent: mocks.notify,
  createNotificationEvent: mocks.notice,
  createSystemNotificationEvent: mocks.systemNotice,
}))
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "session=abc" }), headers: async () => new Headers() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn(), canFeature: vi.fn(async () => true) }))

import { updateProjectSelection, updateProjectSelectionStatus } from "@/app/actions/project-selections"
import { deleteSelectionChoice, getSelectionDetail, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { ownerChangedSelectionAfterPurchase, replaceInstalledSelection } from "@/app/actions/selection-replacements"
import { sendRoundForSignature } from "@/app/actions/selection-round-signing"
import { setChoicePricesFromRfq } from "@/lib/domain/selections/choices-store"
import { notifyPriceChangesDuringSignature } from "@/lib/domain/selections/price-change-notice"
import { replacementBlocker, selectionLock, staffStatusChangeBlocker, staffStatusChoices } from "@/lib/domain/selections/locks"
import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"

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
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

function seed(db: Sqlite): void {
  db.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('apm', 'apm@example.com', 'Ari APM', 'assistant_project_manager', 1, '${NOW}', '${NOW}'),
      ('admin-pa', 'pa@example.com', 'Paz PA', 'project_administrator', 1, '${NOW}', '${NOW}'),
      ('gone', 'gone@example.com', 'Gone PA', 'project_administrator', 0, '${NOW}', '${NOW}'),
      ('crew', 'crew@example.com', 'Cy Crew', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_number, contract_type, created_at) VALUES ('p1', 'Job', 'org-1', 'O-1', 'fixed_price', '${NOW}');
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
      ('m1', 'p1', 'staff', 'project_manager', '${NOW}'),
      ('m2', 'p1', 'apm', 'assistant_project_manager', '${NOW}'),
      ('m3', 'p1', 'admin-pa', 'project_administrator', '${NOW}'),
      ('m4', 'p1', 'gone', 'project_administrator', '${NOW}'),
      ('m5', 'p1', 'crew', 'field_crew', '${NOW}'),
      ('m6', 'p1', 'owner', 'client', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, primary_contact, created_at, updated_at)
      VALUES ('pc1', 'p1', 'owner', 'Olive Owner', 'owner@example.com', 1, '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, category, cost_code, round_key, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'Tile', '09 30 00', 'rough-in', '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Kitchen', 'Faucet', 'Plumbing', '22 40 00', 'rough-in', '${NOW}', '${NOW}');
    INSERT INTO project_selection_decisions (selection_id, project_id, revision, published, specification_json, allowance_cents, last_mutation_id, updated_at) VALUES
      ('tile', 'p1', 1, 1, '{}', 320000, 'm1', '${NOW}'),
      ('faucet', 'p1', 1, 1, '{}', 50000, 'm2', '${NOW}');
    INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'selections', '{"rounds":[{"id":"rough-in","name":"Rough-in","scheduleItem":"","bufferDays":21}],"leadTimeDays":{},"ownerMarkupPercent":null,"changeOrderThresholdPercent":10}', '${NOW}');
  `)
}

async function choice(selectionId: string, title: string, ownerPrice: string): Promise<string> {
  const result = await saveSelectionChoice("p1", selectionId, null, { title, price: "1", ownerPrice })
  if (!result.success) throw new Error(result.error)
  return result.data.id
}

function statusOf(id: string): unknown {
  return sqlite.prepare("SELECT status FROM project_finish_selections WHERE id = ?").get(id)
}

beforeEach(async () => {
  sqlite = migrated()
  seed(sqlite)
  const db = drizzleOverSqlite(sqlite)
  const pdf = await PDFDocument.create()
  pdf.addPage([612, 792])
  pdf.addPage([612, 792])
  const bytes = new Uint8Array(await pdf.save()).buffer
  const env = {
    WORKOS_REDIRECT_URI: "https://compass.example.com/callback",
    FOXIT_ESIGN_CLIENT_ID: "id",
    FOXIT_ESIGN_CLIENT_SECRET: "secret",
    BROWSER: { quickAction: async () => new Response(bytes) },
  } as unknown as CloudflareEnv
  const user = { id: "staff", email: "pm@example.com", displayName: "Pat PM", role: "project_manager", firstName: null, lastName: null }
  mocks.staff.mockResolvedValue({ db, user, organizationId: "org-1", env })
  mocks.context.mockResolvedValue({ success: true, data: { db, user, organizationId: "org-1", env } })
  mocks.audience.mockResolvedValue({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
  mocks.envelope.mockResolvedValue({ envelopeId: "env-1", embeddedSessionUrl: "https://foxit.example.com/send/1" })
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("lock rules", () => {
  it("installed and replaced selections don't move; ordered moves only on to Installed", () => {
    expect(selectionLock("approved", false)).toBeNull()
    expect(selectionLock("ordered", false)?.kind).toBe("ordered")
    expect(selectionLock("needed", true)?.kind).toBe("replaced")
    expect(staffStatusChoices("installed", PROJECT_SELECTION_STATUSES, false)).toEqual(["installed"])
    expect(staffStatusChoices("ordered", PROJECT_SELECTION_STATUSES, false)).toEqual(["ordered", "installed"])
    expect(staffStatusChoices("approved", PROJECT_SELECTION_STATUSES, true)).toEqual(["approved"])
    expect(staffStatusChoices("approved", PROJECT_SELECTION_STATUSES, false)).toEqual(PROJECT_SELECTION_STATUSES)
    expect(staffStatusChangeBlocker("ordered", "owner_review", false)).toMatch(/Owner changed selection after purchase/)
  })

  it("each replacement needs its own status, once", () => {
    expect(replacementBlocker("installed", false, "installed_replaced")).toBeNull()
    expect(replacementBlocker("ordered", false, "installed_replaced")).toMatch(/installed/)
    expect(replacementBlocker("ordered", false, "owner_changed_after_purchase")).toBeNull()
    expect(replacementBlocker("approved", false, "owner_changed_after_purchase")).toMatch(/ordered/)
    expect(replacementBlocker("installed", true, "installed_replaced")).toMatch(/already replaced/)
  })
})

describe("locked selections", () => {
  it("an ordered selection keeps its pick and product; other choices still change", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")

    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: false, error: expect.stringMatching(/ordered/) })
    expect(await setSelectionChoiceChosen("p1", hex, false)).toMatchObject({ success: false })
    expect(await setSelectionChoiceChosen("p1", subway, true, "owner")).toMatchObject({ success: false })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "9999" })).toMatchObject({ success: false })
    expect(await deleteSelectionChoice("p1", hex)).toMatchObject({ success: false })
    expect(await saveSelectionChoice("p1", "tile", subway, { title: "Subway", price: "1", ownerPrice: "3300" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT id FROM project_selection_choices WHERE chosen = 1").all()).toEqual([{ id: hex }])

    // Automation (a supplier's RFQ price) leaves the bought pick alone too.
    await setChoicePricesFromRfq(drizzleOverSqlite(sqlite), "p1", [{ choiceId: hex, selectionId: "tile", priceCents: 1 }, { choiceId: subway, selectionId: "tile", priceCents: 2 }], null, NOW)
    expect(sqlite.prepare("SELECT title, price_cents FROM project_selection_choices ORDER BY title").all()).toEqual([
      { title: "Hex", price_cents: 100 },
      { title: "Subway", price_cents: 2 },
    ])
  })

  it("staff can't move an installed selection, edit its product or delete it; ordered goes on to Installed", async () => {
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")
    expect(await updateProjectSelectionStatus("p1", "tile", "owner_review", "ordered")).toMatchObject({ success: false })
    expect(await updateProjectSelectionStatus("p1", "tile", "installed", "ordered")).toMatchObject({ success: true })
    expect(await updateProjectSelectionStatus("p1", "tile", "approved", "installed")).toMatchObject({ success: false, error: expect.stringMatching(/Replace installed item/) })
    expect(statusOf("tile")).toEqual({ status: "installed" })

    const base = { roomName: "Kitchen", roomType: "", category: "Tile", name: "Backsplash", description: "", quantity: "", manufacturer: "", model: "", colorFinish: "", supplierName: "", productUrl: "", costCode: "09 30 00", phaseCode: "", status: "installed", notes: "", changeReason: "" }
    expect(await updateProjectSelection("p1", "tile", { ...base, model: "Other" })).toMatchObject({ success: false })
    expect(await updateProjectSelection("p1", "tile", { ...base, notes: "Grout sealed" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT notes, model FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ notes: "Grout sealed", model: null })
  })
})

describe("replacing a locked selection", () => {
  it("replaces an installed item with a different product: the old one stays, the new one has the pick and a draft change order", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      INSERT INTO project_selection_links (id, project_id, selection_id, choice_id, url, added_by_audience, created_at) VALUES ('l1', 'p1', 'tile', '${subway}', 'https://example.com/subway', 'staff', '${NOW}');
      UPDATE project_finish_selections SET status = 'installed', model = 'HX-1', owner_approved = 1 WHERE id = 'tile';
    `)

    expect(await replaceInstalledSelection("p1", "faucet", subway, null)).toMatchObject({ success: false })
    expect(await replaceInstalledSelection("p1", "tile", hex, null)).toMatchObject({ success: false, error: expect.stringMatching(/different product/) })
    const done = await replaceInstalledSelection("p1", "tile", subway, "cracked during install")
    if (!done.success) throw new Error(done.error)

    // The installed selection is untouched.
    expect(sqlite.prepare("SELECT status, model, owner_approved FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "installed", model: "HX-1", owner_approved: 1 })
    expect(sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = 'tile' AND chosen = 1").all()).toEqual([{ id: hex }])

    const replacement = sqlite.prepare("SELECT status, name, room_name, cost_code, model, round_key, owner_visible, replaces_selection_id, replacement_reason FROM project_finish_selections WHERE id = ?").get(done.data.selectionId)
    expect(replacement).toEqual({
      status: "proposed",
      name: "Backsplash",
      room_name: "Kitchen",
      cost_code: "09 30 00",
      model: null,
      round_key: null,
      owner_visible: 0,
      replaces_selection_id: "tile",
      replacement_reason: "installed_replaced",
    })
    expect(sqlite.prepare("SELECT title, chosen, chosen_note FROM project_selection_choices WHERE selection_id = ? ORDER BY title").all(done.data.selectionId)).toEqual([
      { title: "Hex", chosen: 0, chosen_note: null },
      { title: "Subway", chosen: 1, chosen_note: "Installed item replaced: cracked during install" },
    ])
    expect(sqlite.prepare("SELECT url FROM project_selection_links WHERE selection_id = ?").all(done.data.selectionId)).toEqual([{ url: "https://example.com/subway" }])

    expect(sqlite.prepare("SELECT id, status, record_type, source_type, source_record_id, amount_cents FROM project_change_orders").get()).toEqual({
      id: done.data.changeOrderId,
      status: "draft",
      record_type: "change_order",
      source_type: "selection_replacement",
      source_record_id: done.data.selectionId,
      amount_cents: 320000,
    })
    expect(sqlite.prepare("SELECT cost_code, amount_cents FROM project_change_order_lines").all()).toEqual([{ cost_code: "09 30 00", amount_cents: 320000 }])

    // Once only; and the replaced selection no longer moves or changes.
    expect(await replaceInstalledSelection("p1", "tile", subway, null)).toMatchObject({ success: false, error: expect.stringMatching(/already replaced/) })
    // A replaced selection is read-only: no choice edits, deletes, additions or picks.
    expect(await saveSelectionChoice("p1", "tile", subway, { title: "Subway", price: "1", ownerPrice: "3300" })).toMatchObject({ success: false, error: expect.stringMatching(/replaced/) })
    expect(await saveSelectionChoice("p1", "tile", null, { title: "Another", price: "1", ownerPrice: "1" })).toMatchObject({ success: false })
    expect(await deleteSelectionChoice("p1", subway)).toMatchObject({ success: false })
    const detail = await getSelectionDetail("p1", "tile")
    expect(detail.success && detail.data).toMatchObject({ lock: { kind: "replaced" }, replacedBy: { id: done.data.selectionId, name: "Backsplash" }, replaces: null })
    const newDetail = await getSelectionDetail("p1", done.data.selectionId)
    expect(newDetail.success && newDetail.data).toMatchObject({ lock: null, replaces: { id: "tile", reason: "installed_replaced" } })
  })

  it("the owner changing their mind after purchase makes a new, unpicked selection; reopen never moves the ordered one", async () => {
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", brass, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'faucet'")

    const done = await ownerChangedSelectionAfterPurchase("p1", "faucet", null, null)
    if (!done.success) throw new Error(done.error)
    expect(statusOf("faucet")).toEqual({ status: "ordered" })
    expect(sqlite.prepare("SELECT status, replacement_reason FROM project_finish_selections WHERE id = ?").get(done.data.selectionId)).toEqual({
      status: "needed",
      replacement_reason: "owner_changed_after_purchase",
    })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id = ? AND chosen = 1").get(done.data.selectionId)).toEqual({ n: 0 })
    // A draft change order with no amount yet: staff price it once the new choice is made.
    expect(sqlite.prepare("SELECT status, amount_cents FROM project_change_orders").get()).toEqual({ status: "draft", amount_cents: 0 })
    expect(await updateProjectSelectionStatus("p1", "faucet", "installed", "ordered")).toMatchObject({ success: false })
  })
})

describe("company settings", () => {
  it("chooses who hears about a price change and whether a replacement starts a change order", async () => {
    sqlite.exec(`UPDATE organization_feature_settings SET value = json_set(value, '$.priceChangeNoticeRoles', json('["field_crew"]'), '$.replacementChangeOrder', json('false')) WHERE feature_key = 'selections'`)
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4500" })).toMatchObject({ success: true })
    expect(mocks.notice.mock.calls[0]?.[0].recipients).toEqual([{ userId: "crew", email: "crew@example.com" }])

    sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
    const done = await replaceInstalledSelection("p1", "tile", subway, null)
    expect(done).toMatchObject({ success: true, data: { changeOrderId: null, changeOrderError: null } })
    // Only the round's own change order exists.
    expect(sqlite.prepare("SELECT source_type FROM project_change_orders").all()).toEqual([{ source_type: "selection_round" }])
  })
})

describe("price changes while out for signature", () => {
  it("tells the job's PMs, APMs and project administrators, with the product and both prices", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    // No signature out yet: no notice.
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4200" })).toMatchObject({ success: true })
    expect(mocks.notice).not.toHaveBeenCalled()

    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4500" })).toMatchObject({ success: true })
    expect(mocks.notice).toHaveBeenCalledTimes(1)
    const notice = mocks.notice.mock.calls[0]?.[0]
    expect(notice).toMatchObject({
      projectId: "p1",
      createdBy: "staff",
      eventType: "selection_price_changed_during_signature",
      title: "Price changed while out for signature: Hex",
      delivery: { inApp: true, email: true, push: true },
    })
    expect(notice.body).toContain("owner price $4,200.00 → $4,500.00")
    expect(notice.body).toContain("Rough-in Selection Phase is being prepared for the owner's signature")
    // The person who changed it isn't told; inactive members and other roles aren't either.
    expect(notice.recipients.map((recipient: { userId: string }) => recipient.userId).sort()).toEqual(["admin-pa", "apm"])

    // A supplier's RFQ price (no signed-in actor): a system notice to all three.
    await notifyPriceChangesDuringSignature(drizzleOverSqlite(sqlite), {
      projectId: "p1",
      changes: [{ choiceId: hex, selectionId: "tile", title: "Hex", before: { priceCents: 100, ownerPriceCents: 450000 }, after: { priceCents: 5000, ownerPriceCents: 450000 } }],
      actor: null,
      now: NOW,
    })
    const system = mocks.systemNotice.mock.calls[0]?.[0]
    expect(system.body).toContain("supplier price $1.00 → $50.00")
    expect(system.recipients.map((recipient: { userId: string }) => recipient.userId).sort()).toEqual(["admin-pa", "apm", "staff"])
  })
})
