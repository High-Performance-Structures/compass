import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Review follow-ups to the selection locks (2026-11-12), against a database
 * built from every migration: partner visibility after signing, notice roles
 * however a membership spells them, locked rows keeping their approval,
 * honest "signed" labels, replacement change orders, round assignment, the
 * daily-log checklist, read-only replaced selections, in-write lock checks,
 * staff-only notice roles, the owner's click without a change order, and
 * replacement deletes and follow-ups.
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
vi.mock("@/app/actions/project-audience-preview", () => ({ getProjectAudiencePreview: vi.fn(async () => ({ rfqs: [], operations: [] })) }))

import { deleteProjectSelection, updateProjectSelection } from "@/app/actions/project-selections"
import { getSelectionDetail, getSelectionSheet, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { publishSelectionDecision } from "@/app/actions/selection-decisions"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { createReplacementChangeOrder, ownerChangedSelectionAfterPurchase, replaceInstalledSelection } from "@/app/actions/selection-replacements"
import { sendRoundForSignature } from "@/app/actions/selection-round-signing"
import { assignSelectionRound } from "@/app/actions/selection-templates"
import { dailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { setSelectionChoiceChosen as setChosenRow, updateSelectionChoice } from "@/lib/domain/selections/choices-store"
import { applyExecutedReplacementChangeOrder } from "@/lib/domain/selections/replacement-signing"
import { repriceReplacementChangeOrder } from "@/lib/domain/selections/replacement-pricing"
import { advanceSelectionsForPurchaseOrder } from "@/lib/domain/selections/status-advance"
import { supplierCouldntFillSelection, updateReplacementChangeOrder } from "@/app/actions/selection-replacements"
import { updateProjectSelectionStatus } from "@/app/actions/project-selections"
import { getRoundSigning } from "@/app/actions/selection-round-signing"
import { getOwnerChoiceBoard } from "@/app/actions/selection-choices"
import { addSelectionLink } from "@/app/actions/selection-choices"
import { canFeature } from "@/lib/permission-enforcement"
import { selectionSettingsSchema } from "@/lib/feature-settings/selection-settings"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { specificationJson } from "@/lib/selections/decisions"
import { projectFinishSelections } from "@/db/schema"
import { eq } from "drizzle-orm"

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
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('om-staff', 'org-1', 'staff', 'project_manager', '${NOW}'),
      ('om-apm', 'org-1', 'apm', 'assistant_project_manager', '${NOW}'),
      ('om-pa', 'org-1', 'admin-pa', 'project_administrator', '${NOW}'),
      ('om-gone', 'org-1', 'gone', 'project_administrator', '${NOW}'),
      ('om-crew', 'org-1', 'crew', 'field_crew', '${NOW}'),
      ('om-owner', 'org-1', 'owner', 'client', '${NOW}');
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


const base = { roomName: "Kitchen", roomType: "", category: "Tile", name: "Backsplash", description: "", quantity: "", manufacturer: "", model: "", colorFinish: "", supplierName: "", productUrl: "", costCode: "09 30 00", phaseCode: "", notes: "", changeReason: "" }

async function installedTileReplacedBySubway(): Promise<{ readonly hex: string; readonly subway: string; readonly replacementId: string; readonly changeOrderId: string | null }> {
  const hex = await choice("tile", "Hex", "4185")
  const subway = await choice("tile", "Subway", "3200")
  await setSelectionChoiceChosen("p1", hex, true)
  sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
  const done = await replaceInstalledSelection("p1", "tile", subway, null)
  if (!done.success) throw new Error(done.error)
  return { hex, subway, replacementId: done.data.selectionId, changeOrderId: done.data.changeOrderId }
}

describe("review follow-ups", () => {
  it("1: partners see a specification only once a signature finalizes it, not on the owner's click", async () => {
    const db = drizzleOverSqlite(sqlite)
    const row = await db.select().from(projectFinishSelections).where(eq(projectFinishSelections.id, "tile")).get()
    if (!row) throw new Error("no row")
    // Published and confirmed by the owner's click, for the current specification.
    sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ?, approved_at = ?, approved_by_name = 'Olive Owner' WHERE selection_id = 'tile'").run(specificationJson(row), NOW)
    const vendor = { db, user: { id: "vendor" }, staff: false, actorName: "Vendor" }
    mocks.audience.mockResolvedValueOnce(vendor)
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.map((item) => item.id)).not.toContain("tile")
    // Signed: the status and owner approval come from the signature.
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile'")
    mocks.audience.mockResolvedValueOnce(vendor)
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.map((item) => item.id)).toContain("tile")
  })

  it("2 + 9: a 'project-manager' membership is told; the job's named PM too; non-staff never, and settings refuse non-staff roles", async () => {
    sqlite.exec(`
      UPDATE project_members SET role = 'project-manager' WHERE id = 'm2';
      INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('named', 'named@example.com', 'Nia Named', 'project_manager', 1, '${NOW}', '${NOW}');
      INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('om-named', 'org-1', 'named', 'project_manager', '${NOW}');
      UPDATE projects SET project_manager = 'Nia Named' WHERE id = 'p1';
      UPDATE organization_feature_settings SET value = json_set(value, '$.priceChangeNoticeRoles', json('["project_manager"]')) WHERE feature_key = 'selections';
    `)
    const hex = await choice("tile", "Hex", "4185")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4500" })).toMatchObject({ success: true })
    const recipients = mocks.notice.mock.calls[0]?.[0].recipients.map((recipient: { userId: string }) => recipient.userId).sort()
    // apm's membership says "project-manager"; the actor (staff) isn't told; "named" is the job's PM by name.
    expect(recipients).toEqual(["apm", "named"])
    expect(selectionSettingsSchema.safeParse({ ...FEATURE_SETTINGS.selections.defaults, priceChangeNoticeRoles: ["client"] }).success).toBe(false)
  })

  it("3: an ordered or installed selection can't be published again, and edits never clear its approval or move its cost code", async () => {
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1, approved_at = '2026-11-01' WHERE id = 'tile'")
    const row = sqlite.prepare("SELECT updated_at AS updatedAt FROM project_finish_selections WHERE id = 'tile'").get() as { updatedAt: string }
    mocks.audience.mockResolvedValueOnce({ db: drizzleOverSqlite(sqlite), user: { id: "staff" }, staff: true, actorName: "Pat PM" })
    expect(
      await publishSelectionDecision("p1", { selectionId: "tile", expectedRevision: 1, selectionUpdatedAt: row.updatedAt, published: false, decisionDueDate: "", allowance: "", price: "", scheduleImpact: "", ownerNote: "", requiresChangeOrder: false, changeOrderId: "" }),
    ).toMatchObject({ success: false, error: expect.stringMatching(/ordered/) })
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "ordered", costCode: "09 30 01" })).toMatchObject({ success: false })
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "ordered", roomName: "Pantry" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT room_name, cost_code, owner_approved, approved_at FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({
      room_name: "Pantry",
      cost_code: "09 30 00",
      owner_approved: 1,
      approved_at: "2026-11-01",
    })
    sqlite.exec("UPDATE project_finish_selections SET status = 'installed', room_name = 'Kitchen' WHERE id = 'tile'")
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "installed", roomName: "Pantry" })).toMatchObject({ success: false })
  })

  it("4: 'Approved' reads signed only when a signature covers it", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id IN ('tile', 'faucet')")
    sqlite.exec(`
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('sig', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig', 'tile', '${hex}', 'Hex');
    `)
    const sheet = await getSelectionSheet("p1")
    expect(Object.fromEntries(sheet.rows.map((row) => [row.id, row.signed]))).toEqual({ faucet: false, tile: true })
  })

  it("5a: executing a replacement's change order approves the replacement and adds its Order to-do, once", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    if (!changeOrderId) throw new Error("no change order")
    const db = drizzleOverSqlite(sqlite)
    expect(await applyExecutedReplacementChangeOrder(db, { projectId: "p1", changeOrderId, actorId: "staff" })).toBe(false)
    sqlite.exec(`UPDATE project_change_orders SET status = 'executed' WHERE id = '${changeOrderId}'`)
    expect(await applyExecutedReplacementChangeOrder(db, { projectId: "p1", changeOrderId, actorId: "staff" })).toBe(true)
    expect(await applyExecutedReplacementChangeOrder(db, { projectId: "p1", changeOrderId, actorId: "staff" })).toBe(false)
    expect(sqlite.prepare("SELECT status, owner_approved FROM project_finish_selections WHERE id = ?").get(replacementId)).toEqual({ status: "approved", owner_approved: 1 })
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM project_operations WHERE source_record_id = ? AND json_extract(sage_payload_json, '$.selectionStep') = 'order'").get(replacementId),
    ).toEqual({ n: 1 })
    const sheet = await getSelectionSheet("p1")
    expect(sheet.rows.find((row) => row.id === replacementId)?.signed).toBe(true)
  })

  it("5b: a replacement without a change order gets one from 'Create change order', once", async () => {
    sqlite.exec(`UPDATE organization_feature_settings SET value = json_set(value, '$.replacementChangeOrder', json('false')) WHERE feature_key = 'selections'`)
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    expect(changeOrderId).toBeNull()
    const made = await createReplacementChangeOrder("p1", replacementId)
    expect(made).toMatchObject({ success: true })
    expect(await createReplacementChangeOrder("p1", replacementId)).toMatchObject({ success: false, error: expect.stringMatching(/already/) })
    expect(await createReplacementChangeOrder("p1", "faucet")).toMatchObject({ success: false })
    const detail = await getSelectionDetail("p1", replacementId)
    expect(detail.success && detail.data.replacementChangeOrder).toMatchObject({ status: "draft" })
    expect(sqlite.prepare("SELECT amount_cents FROM project_change_orders").get()).toEqual({ amount_cents: 320000 })
  })

  it("5b: a change order number taken meanwhile is retried", async () => {
    // The first insert is refused as a duplicate number (as when another change order took it); the retry lands.
    let refusals = 0
    // better-sqlite3's user functions (missing from this project's typings).
    Reflect.apply(Reflect.get(sqlite, "function"), sqlite, ["refuse_once", { deterministic: false }, () => (refusals++ === 0 ? 1 : 0)])
    sqlite.exec(`
      CREATE TRIGGER number_taken BEFORE INSERT ON project_change_orders
      WHEN refuse_once() = 1
      BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: project_change_orders.project_id, project_change_orders.change_order_number'); END;
    `)
    const { changeOrderId } = await installedTileReplacedBySubway()
    expect(changeOrderId).not.toBeNull()
    expect(refusals).toBeGreaterThanOrEqual(2)
  })

  it("5c: replacement, ordered, installed and replaced selections never join a Selection Phase, but can leave one", async () => {
    const { replacementId } = await installedTileReplacedBySubway()
    expect(await assignSelectionRound("p1", [replacementId], "rough-in")).toMatchObject({ success: false })
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'faucet'")
    expect(await assignSelectionRound("p1", ["faucet"], "rough-in")).toMatchObject({ success: false })
    // Taking a locked row out of its phase is allowed (round_key cleared only).
    expect(await assignSelectionRound("p1", ["tile", "faucet"], null)).toMatchObject({ success: true, data: { count: 2 } })
    expect(sqlite.prepare("SELECT id, round_key FROM project_finish_selections ORDER BY id").all()).toEqual(
      [
        { id: "faucet", round_key: null },
        { id: replacementId, round_key: null },
        { id: "tile", round_key: null },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  it("6: the daily-log checklist leaves out a replaced selection; its replacement is offered", async () => {
    const brass = await choice("faucet", "Brass", "380")
    await choice("faucet", "Chrome", "300")
    await setSelectionChoiceChosen("p1", brass, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'faucet'")
    const done = await ownerChangedSelectionAfterPurchase("p1", "faucet", null, null)
    if (!done.success) throw new Error(done.error)
    const setup = await dailyLogFollowUpSetup(drizzleOverSqlite(sqlite), "org-1", "p1")
    const ids = (setup.installableSelections ?? []).map((item) => item.id)
    expect(ids).not.toContain("faucet")
    expect(ids).toContain(done.data.selectionId)
  })

  it("8: the store refuses a locked pick or a replaced selection's choice even after a stale read", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")
    const db = drizzleOverSqlite(sqlite)
    expect(await setChosenRow(db, "tile", subway, true, NOW, { userId: "staff", audience: "staff", note: null })).toBe(false)
    expect(await updateSelectionChoice(db, "p1", hex, { title: "Changed", updatedAt: NOW })).toBe(false)
    expect(await updateSelectionChoice(db, "p1", subway, { title: "Subway tile", updatedAt: NOW })).toBe(true)
    expect(sqlite.prepare("SELECT title, chosen FROM project_selection_choices ORDER BY title").all()).toEqual([
      { title: "Hex", chosen: 1 },
      { title: "Subway tile", chosen: 0 },
    ])
  })

  it("11: a replacement carries follow-up links, and can't be deleted while its change order is live", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    sqlite.exec(`
      INSERT INTO project_selection_choice_dependents (choice_id, selection_id, created_at) VALUES ('${subway}', 'faucet', '${NOW}'), ('${brass}', 'tile', '${NOW}');
    `)
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
    const done = await replaceInstalledSelection("p1", "tile", subway, null)
    if (!done.success) throw new Error(done.error)
    const newSubway = sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Subway'").get(done.data.selectionId) as { id: string }
    expect(sqlite.prepare("SELECT choice_id, selection_id FROM project_selection_choice_dependents ORDER BY choice_id, selection_id").all()).toEqual(
      [
        { choice_id: subway, selection_id: "faucet" },
        { choice_id: brass, selection_id: "tile" },
        { choice_id: newSubway.id, selection_id: "faucet" },
        { choice_id: brass, selection_id: done.data.selectionId },
      ].sort((a, b) => (a.choice_id + a.selection_id).localeCompare(b.choice_id + b.selection_id)),
    )
    expect(await deleteProjectSelection("p1", done.data.selectionId)).toMatchObject({ success: false })
    sqlite.exec("UPDATE project_change_orders SET status = 'void'")
    expect(await deleteProjectSelection("p1", done.data.selectionId)).toMatchObject({ success: true })
  })

  it("R2-2: ordered, replaced and older-approved rows are outside the phase document, its progress and its change order", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    // A pick-less ordered faucet would otherwise block the phase forever.
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'faucet'")
    const view = await getRoundSigning("p1", "rough-in")
    if (!view.success) throw new Error(view.error)
    expect(view.data.document.lines.map((line) => line.selectionId)).toEqual(["tile"])
    expect(view.data.document.blocker).toBeNull()
    // An older approval without a signature isn't signed or billed again.
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile'")
    const again = await getRoundSigning("p1", "rough-in")
    if (!again.success) throw new Error(again.error)
    expect(again.data.document.lines).toEqual([])
    const sheet = await getSelectionSheet("p1")
    expect(sheet.rounds.find((round) => round.key === "rough-in")).toMatchObject({ total: 0, chosen: 0 })
  })

  it("R2-3: signed means the current pick is the signed one; a live replacement change order fixes the pick", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile';
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('sig', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig', 'tile', '${hex}', 'Hex');
    `)
    expect((await getSelectionSheet("p1")).rows.find((row) => row.id === "tile")?.signed).toBe(true)
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 0 WHERE selection_id = 'tile'; UPDATE project_selection_choices SET chosen = 1 WHERE id = '${subway}'`)
    expect((await getSelectionSheet("p1")).rows.find((row) => row.id === "tile")?.signed).toBe(false)

    // A replacement whose change order is out for signature keeps its pick.
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 0 WHERE selection_id = 'tile'; UPDATE project_selection_choices SET chosen = 1 WHERE id = '${hex}'`)
    sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
    const done = await replaceInstalledSelection("p1", "tile", subway, null)
    if (!done.success) throw new Error(done.error)
    const copies = sqlite.prepare("SELECT id, title FROM project_selection_choices WHERE selection_id = ?").all(done.data.selectionId) as { id: string; title: string }[]
    const copiedHex = copies.find((copy) => copy.title === "Hex")?.id ?? ""
    expect(await setSelectionChoiceChosen("p1", copiedHex, true)).toMatchObject({ success: true })
    // The draft followed the new pick in place: same change order, its pick line re-priced for Hex.
    expect(sqlite.prepare("SELECT id, status, amount_cents FROM project_change_orders").all()).toEqual([{ id: done.data.changeOrderId, status: "draft", amount_cents: 418500 }])
    expect(sqlite.prepare("SELECT event_type FROM project_change_order_history WHERE change_order_id = ? ORDER BY created_at").all(done.data.changeOrderId)).toEqual([
      { event_type: "created_from_selection_replacement" },
      { event_type: "repriced_for_selection_pick" },
    ])
    sqlite.exec(`UPDATE project_change_orders SET status = 'signature_pending' WHERE status = 'draft'`)
    const copiedSubway = copies.find((copy) => copy.title === "Subway")?.id ?? ""
    expect(await setSelectionChoiceChosen("p1", copiedSubway, true)).toMatchObject({ success: false, error: expect.stringMatching(/change order/) })
  })

  it("R2-4: a room edit on an ordered row keeps its published decision current for partners", async () => {
    const db = drizzleOverSqlite(sqlite)
    const row = await db.select().from(projectFinishSelections).where(eq(projectFinishSelections.id, "tile")).get()
    if (!row) throw new Error("no row")
    sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ? WHERE selection_id = 'tile'").run(specificationJson(row))
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1 WHERE id = 'tile'")
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "ordered", roomName: "Pantry" })).toMatchObject({ success: true })
    // The room move isn't a product change: the decision stays current (a product change still isn't).
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "staff" }, staff: true, actorName: "Pat PM" })
    expect((await getSelectionWorkspace("p1", "staff")).items.find((item) => item.id === "tile")?.current).toBe(true)
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "vendor" }, staff: false, actorName: "Vendor" })
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.map((item) => item.id)).toContain("tile")
  })

  it("R2-5: a declined replacement change order counts as ended", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    sqlite.exec(`UPDATE project_change_orders SET status = 'declined' WHERE id = '${changeOrderId}'`)
    const detail = await getSelectionDetail("p1", replacementId)
    expect(detail.success && detail.data.replacementChangeOrder).toBeNull()
    expect(await createReplacementChangeOrder("p1", replacementId)).toMatchObject({ success: true })
    // Declined and a new live one: delete is blocked by the live one only.
    sqlite.exec(`UPDATE project_change_orders SET status = 'declined'`)
    expect(await deleteProjectSelection("p1", replacementId)).toMatchObject({ success: true })
  })

  it("R2-6: without change-order permission the replacement is made and the change order left for someone who may", async () => {
    vi.mocked(canFeature).mockResolvedValue(false)
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
    const done = await replaceInstalledSelection("p1", "tile", subway, null)
    expect(done).toMatchObject({ success: true, data: { changeOrderId: null, changeOrderError: expect.stringMatching(/permission/) } })
    if (!done.success) throw new Error(done.error)
    const detail = await getSelectionDetail("p1", done.data.selectionId)
    expect(detail.success && detail.data.canCreateChangeOrder).toBe(false)
    vi.mocked(canFeature).mockResolvedValue(true)
  })

  it("R2-7 + R2-10: replaced rows are hidden from partners, marked on the owner board, and refuse links in the write", async () => {
    const { replacementId } = await installedTileReplacedBySubway()
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 1 WHERE id = 'tile'")
    const db = drizzleOverSqlite(sqlite)
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "vendor" }, staff: false, actorName: "Vendor" })
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.map((item) => item.id)).not.toContain("tile")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
    const board = await getOwnerChoiceBoard("p1")
    expect(board.find((item) => item.id === "tile")?.replacedByName).toBe("Backsplash")
    expect(await addSelectionLink("p1", "tile", null, "https://example.com/x")).toMatchObject({ success: false })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_links WHERE selection_id = 'tile'").get()).toEqual({ n: 0 })
    // One live change order per replacement, even on a double submit.
    expect(await createReplacementChangeOrder("p1", replacementId)).toMatchObject({ success: false })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_change_orders WHERE source_record_id = ?").get(replacementId)).toEqual({ n: 1 })
  })

  it("R2-8: an older owner approval reads 'Approved' to the owner, not 'not final'", async () => {
    const row = await drizzleOverSqlite(sqlite).select().from(projectFinishSelections).where(eq(projectFinishSelections.id, "tile")).get()
    if (!row) throw new Error("no row")
    sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ? WHERE selection_id = 'tile'").run(specificationJson(row))
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1 WHERE id = 'tile'")
    mocks.audience.mockResolvedValueOnce({ db: drizzleOverSqlite(sqlite), user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
    const tile = (await getSelectionWorkspace("p1", "owner")).items.find((item) => item.id === "tile")
    expect(tile).toMatchObject({ signed: false, ownerApproved: true })
  })

  it("R2-11: the named project manager must be staff in the job's company", async () => {
    sqlite.exec(`
      INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('named', 'named@example.com', 'Nia Named', 'project_manager', 1, '${NOW}', '${NOW}');
      INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('om-named', 'org-1', 'named', 'client', '${NOW}');
      UPDATE projects SET project_manager = 'Nia Named' WHERE id = 'p1';
    `)
    const hex = await choice("tile", "Hex", "4185")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4500" })).toMatchObject({ success: true })
    const recipients = mocks.notice.mock.calls[0]?.[0].recipients.map((recipient: { userId: string }) => recipient.userId)
    expect(recipients).not.toContain("named")
  })

  it("R3-1: changing the pick of an older (imported) approval reopens it for signing", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, approved_at = '2026-01-01', source_system = 'buildertrend' WHERE id = 'tile'")
    // Outside the phase while approved...
    const view = await getRoundSigning("p1", "rough-in")
    expect(view.success && view.data.document.lines.map((line) => line.selectionId)).not.toContain("tile")
    // ...and back in it once its pick changes.
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status, owner_approved, approved_at FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "owner_review", owner_approved: 0, approved_at: null })
    const again = await getRoundSigning("p1", "rough-in")
    expect(again.success && again.data.document.lines.map((line) => line.selectionId)).toContain("tile")
  })

  it("R3-2 + R3-3: a replacement change order is tied to its priced pick", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    if (!changeOrderId) throw new Error("no change order")
    const copies = sqlite.prepare("SELECT id, title, chosen FROM project_selection_choices WHERE selection_id = ?").all(replacementId) as { id: string; title: string; chosen: number }[]
    const subwayCopy = copies.find((copy) => copy.title === "Subway")?.id ?? ""
    const hexCopy = copies.find((copy) => copy.title === "Hex")?.id ?? ""
    expect(sqlite.prepare("SELECT replacement_priced_choice_id AS priced FROM project_finish_selections WHERE id = ?").get(replacementId)).toEqual({ priced: subwayCopy })
    // While the change order is a draft, the pick can be corrected and the draft follows its price in place.
    expect(await saveSelectionChoice("p1", replacementId, subwayCopy, { title: "Subway", price: "1", ownerPrice: "3500" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT id, amount_cents FROM project_change_orders").all()).toEqual([{ id: changeOrderId, amount_cents: 350000 }])
    // Once it is out for signature, the pick is read-only.
    sqlite.exec(`UPDATE project_change_orders SET status = 'signature_pending' WHERE id = '${changeOrderId}'`)
    expect(await saveSelectionChoice("p1", replacementId, subwayCopy, { title: "Subway", price: "1", ownerPrice: "1" })).toMatchObject({ success: false })
    sqlite.exec(`UPDATE project_change_orders SET status = 'draft' WHERE id = '${changeOrderId}'`)
    expect(await saveSelectionChoice("p1", replacementId, hexCopy, { title: "Hex tile", price: "1", ownerPrice: "4185" })).toMatchObject({ success: true })
    // The change order can't leave draft without a pick, or for a pick it wasn't priced for.
    const { replacementChangeOrderMoveBlocker } = await import("@/lib/domain/selections/replacement-signing")
    const db = drizzleOverSqlite(sqlite)
    expect(await replacementChangeOrderMoveBlocker(db, { projectId: "p1", changeOrderId, to: "signature_pending" })).toBeNull()
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 0 WHERE selection_id = '${replacementId}'`)
    expect(await replacementChangeOrderMoveBlocker(db, { projectId: "p1", changeOrderId, to: "signature_pending" })).toMatch(/Pick the replacement product/)
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 1 WHERE id = '${hexCopy}'`)
    expect(await replacementChangeOrderMoveBlocker(db, { projectId: "p1", changeOrderId, to: "executed" })).toMatch(/pick changed/)
    expect(await replacementChangeOrderMoveBlocker(db, { projectId: "p1", changeOrderId, to: "void" })).toBeNull()
    // Executed for Subway while Hex is picked: not signed, not approved.
    sqlite.exec(`UPDATE project_change_orders SET status = 'executed' WHERE id = '${changeOrderId}'`)
    expect(await applyExecutedReplacementChangeOrder(db, { projectId: "p1", changeOrderId, actorId: "staff" })).toBe(false)
    expect((await getSelectionSheet("p1")).rows.find((row) => row.id === replacementId)?.signed).toBe(false)
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 0 WHERE selection_id = '${replacementId}'; UPDATE project_selection_choices SET chosen = 1 WHERE id = '${subwayCopy}'`)
    expect((await getSelectionSheet("p1")).rows.find((row) => row.id === replacementId)?.signed).toBe(true)
  })

  it("R3-2: a phase-signed pick is read-only before it is ordered", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('sig', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig', 'tile', '${hex}', 'Hex');
      UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile';
    `)
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "1" })).toMatchObject({ success: false, error: expect.stringMatching(/signature/) })
    expect(sqlite.prepare("SELECT owner_price_cents FROM project_selection_choices WHERE id = ?").get(hex)).toEqual({ owner_price_cents: 418500 })
  })

  it("R3-4: a price change while a replacement change order is with the owner tells the managers", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    sqlite.exec(`UPDATE project_change_orders SET status = 'signature_pending' WHERE id = '${changeOrderId}'`)
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    expect(await saveSelectionChoice("p1", replacementId, hexCopy, { title: "Hex", price: "1", ownerPrice: "4300" })).toMatchObject({ success: true })
    const notice = mocks.notice.mock.calls[0]?.[0]
    expect(notice.body).toMatch(/Replacement change order .* is with the owner, not signed yet \(this is not the choice on the document\)/)
  })

  it("R3-5: a locked selection moved to another room shows its new room to partners and owners", async () => {
    const db = drizzleOverSqlite(sqlite)
    const row = await db.select().from(projectFinishSelections).where(eq(projectFinishSelections.id, "tile")).get()
    if (!row) throw new Error("no row")
    sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ? WHERE selection_id = 'tile'").run(specificationJson(row))
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1, room_name = 'Pantry' WHERE id = 'tile'")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "vendor" }, staff: false, actorName: "Vendor" })
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.find((item) => item.id === "tile")?.spec.roomName).toBe("Pantry")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
    expect((await getSelectionWorkspace("p1", "owner")).items.find((item) => item.id === "tile")?.spec.roomName).toBe("Pantry")
  })

  it("R3-6: an edit never writes the approval columns from its read unless it clears them", async () => {
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 0 WHERE id = 'tile'")
    // The owner's signature lands between the edit's read and its write.
    sqlite.exec(`
      CREATE TRIGGER sign_between BEFORE UPDATE OF notes ON project_finish_selections
      WHEN OLD.id = 'tile' AND OLD.owner_approved = 0
      BEGIN UPDATE project_finish_selections SET owner_approved = 1, approved_at = '${NOW}' WHERE id = 'tile'; END;
    `)
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "needed", notes: "Grout sealed" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT notes, owner_approved, approved_at FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ notes: "Grout sealed", owner_approved: 1, approved_at: NOW })
  })

  it("R3-8: notice roles are checked against the job company's membership, not the account role", async () => {
    sqlite.exec("UPDATE organization_members SET role = 'client' WHERE user_id = 'apm'")
    const hex = await choice("tile", "Hex", "4185")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "4500" })).toMatchObject({ success: true })
    expect(mocks.notice.mock.calls[0]?.[0].recipients.map((recipient: { userId: string }) => recipient.userId)).toEqual(["admin-pa"])
  })

  it("R4-1: a changed approved pick is billed against the settled price; with none recorded it is refused", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('sig', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig', 'tile', '${hex}', 'Hex');
      UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile';
    `)
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status, owner_approved, settled_owner_price_cents AS settled FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "owner_review", owner_approved: 0, settled: 418500 })
    // Billed as the difference from the signed Hex (a credit), not Subway minus the allowance.
    const view = await getRoundSigning("p1", "rough-in")
    if (!view.success) throw new Error(view.error)
    expect(view.data.document.lines.find((line) => line.selectionId === "tile")?.deltaCents).toBe(320000 - 418500)

    // An imported approval with nothing chosen has no price to bill against: refused.
    const brass = await choice("faucet", "Brass", "380")
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, source_system = 'buildertrend' WHERE id = 'faucet'")
    expect(await setSelectionChoiceChosen("p1", brass, true)).toMatchObject({ success: false, error: expect.stringMatching(/Buildertrend without a recorded price/) })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_choices WHERE selection_id = 'faucet' AND chosen = 1").get()).toEqual({ n: 0 })
  })

  it("R4-1 + R4-5: Ordered → Unavailable keeps the settled price and lets go of the old purchase order", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      INSERT INTO project_operations (id, project_id, source_record_type, title, created_at, updated_at) VALUES ('po-1', 'p1', 'purchase_order', 'Tile PO', '2026-11-01T00:00:00.000Z', '${NOW}');
      INSERT INTO project_selection_procurement_links (id, project_id, selection_id, operation_id, specification_json, created_at) VALUES ('pl', 'p1', 'tile', 'po-1', '{}', '2026-11-01T00:00:00.000Z');
      UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1, purchase_order_operation_id = 'po-1' WHERE id = 'tile';
    `)
    expect(await updateProjectSelectionStatus("p1", "tile", "unavailable", "ordered")).toMatchObject({ success: true })
    const row = sqlite.prepare("SELECT purchase_order_operation_id AS po, procurement_released_at AS released, settled_owner_price_cents AS settled FROM project_finish_selections WHERE id = 'tile'").get() as { po: string | null; released: string | null; settled: number | null }
    expect(row).toMatchObject({ po: null, settled: 418500 })
    expect(row.released).not.toBeNull()
    // The link stays on record.
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_procurement_links").get()).toEqual({ n: 1 })
    // Re-picked (back to the owner), the old purchase order can't move it to Ordered again.
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: true })
    expect(await advanceSelectionsForPurchaseOrder(drizzleOverSqlite(sqlite), { projectId: "p1", purchaseOrderId: "po-1", purchaseOrderNumber: "PO-1", status: "sent", actor: { id: "staff", email: "pm@example.com", displayName: "Pat PM", firstName: null, lastName: null, role: "project_manager" } })).toEqual([])
    expect(sqlite.prepare("SELECT status FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "owner_review" })
  })

  it("R4-2 + R4-3: the owner's pick never touches the change order; staff update it in place, keeping its number and lines", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    if (!changeOrderId) throw new Error("no change order")
    const number = (sqlite.prepare("SELECT change_order_number AS n FROM project_change_orders").get() as { n: string }).n
    sqlite.exec(`
      INSERT INTO project_change_order_lines (id, project_id, change_order_id, line_number, description, cost_code, amount_cents, created_at, updated_at)
        VALUES ('staff-line', 'p1', '${changeOrderId}', 9, 'Removal labor', '09 30 00', 25000, '${NOW}', '${NOW}');
      INSERT INTO project_selection_decisions (selection_id, project_id, revision, published, specification_json, last_mutation_id, updated_at) VALUES ('${replacementId}', 'p1', 1, 1, '{}', 'm9', '${NOW}');
    `)
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    expect(await setSelectionChoiceChosen("p1", hexCopy, true, "owner")).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT amount_cents FROM project_change_orders").get()).toEqual({ amount_cents: 320000 })
    const stale = await getSelectionDetail("p1", replacementId)
    expect(stale.success && stale.data.replacementPricingStale).toBe(true)

    expect(await updateReplacementChangeOrder("p1", replacementId)).toMatchObject({ success: true, data: { changeOrderNumber: number } })
    expect(sqlite.prepare("SELECT id, change_order_number AS n, status, amount_cents FROM project_change_orders").all()).toEqual([{ id: changeOrderId, n: number, status: "draft", amount_cents: 418500 + 25000 }])
    expect(sqlite.prepare("SELECT id FROM project_change_order_lines WHERE id = 'staff-line'").get()).toEqual({ id: "staff-line" })
    const fresh = await getSelectionDetail("p1", replacementId)
    expect(fresh.success && fresh.data.replacementPricingStale).toBe(false)
    expect(sqlite.prepare("SELECT action FROM activity_events WHERE action = 'selection_replacement_repriced'").all()).toHaveLength(1)
  })

  it("R4-3: without change-order permission a staff pick leaves the draft flagged", async () => {
    const { replacementId } = await installedTileReplacedBySubway()
    vi.mocked(canFeature).mockResolvedValue(false)
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    expect(await setSelectionChoiceChosen("p1", hexCopy, true)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT amount_cents FROM project_change_orders").get()).toEqual({ amount_cents: 320000 })
    vi.mocked(canFeature).mockResolvedValue(true)
    const detail = await getSelectionDetail("p1", replacementId)
    expect(detail.success && detail.data.replacementPricingStale).toBe(true)
  })

  it("R4-4: a re-price that loses a race writes no line, total or history", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    sqlite.exec(`UPDATE project_selection_choices SET chosen = 0 WHERE selection_id = '${replacementId}'; UPDATE project_selection_choices SET chosen = 1 WHERE id = '${hexCopy}'`)
    // Another re-price lands first: this one's guarded selection write is skipped.
    sqlite.exec(`CREATE TRIGGER lose_race BEFORE UPDATE OF replacement_priced_choice_id ON project_finish_selections BEGIN SELECT RAISE(IGNORE); END;`)
    const result = await repriceReplacementChangeOrder(drizzleOverSqlite(sqlite), { projectId: "p1", selectionId: replacementId, by: { kind: "system" } })
    expect(result.kind).toBe("skipped")
    expect(sqlite.prepare("SELECT amount_cents FROM project_change_orders WHERE id = ?").get(changeOrderId)).toEqual({ amount_cents: 320000 })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_change_order_history WHERE event_type = 'repriced_for_selection_pick'").get()).toEqual({ n: 0 })
  })

  it("R4-6: an order the supplier couldn't fill can be replaced, also a replacement with an executed change order", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    sqlite.exec(`UPDATE project_change_orders SET status = 'executed' WHERE id = '${changeOrderId}'`)
    sqlite.exec(`UPDATE project_finish_selections SET status = 'ordered' WHERE id = '${replacementId}'`)
    expect(await updateProjectSelectionStatus("p1", replacementId, "unavailable", "ordered")).toMatchObject({ success: true })
    const detail = await getSelectionDetail("p1", replacementId)
    expect(detail.success && detail.data.canReplaceUnfilled).toBe(true)
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    const done = await supplierCouldntFillSelection("p1", replacementId, hexCopy, "discontinued")
    if (!done.success) throw new Error(done.error)
    // Priced as the difference from what the contract already holds (Subway at $3,200).
    expect(sqlite.prepare("SELECT amount_cents FROM project_change_order_lines WHERE change_order_id = ? AND derived_from IS NULL").get(done.data.changeOrderId)).toEqual({ amount_cents: 418500 - 320000 })
    expect(await supplierCouldntFillSelection("p1", "faucet", null, null)).toMatchObject({ success: false })
  })

  it("R4-7: a supplier price on a replacement's pick re-prices its draft in place", async () => {
    const { replacementId, changeOrderId } = await installedTileReplacedBySubway()
    sqlite.exec(`UPDATE project_selection_choices SET owner_price_cents = 330000 WHERE selection_id = '${replacementId}' AND chosen = 1`)
    expect(await repriceReplacementChangeOrder(drizzleOverSqlite(sqlite), { projectId: "p1", selectionId: replacementId, by: { kind: "system" } })).toMatchObject({ kind: "repriced" })
    expect(sqlite.prepare("SELECT id, amount_cents FROM project_change_orders").all()).toEqual([{ id: changeOrderId, amount_cents: 330000 }])
  })

  it("R4-9: a room move keeps a locked selection's procurement link current", async () => {
    const db = drizzleOverSqlite(sqlite)
    const row = await db.select().from(projectFinishSelections).where(eq(projectFinishSelections.id, "tile")).get()
    if (!row) throw new Error("no row")
    sqlite.exec(`INSERT INTO project_operations (id, project_id, source_record_type, title, created_at, updated_at) VALUES ('po-1', 'p1', 'purchase_order', 'Tile PO', '${NOW}', '${NOW}')`)
    sqlite.prepare("INSERT INTO project_selection_procurement_links (id, project_id, selection_id, operation_id, specification_json, created_at) VALUES ('pl', 'p1', 'tile', 'po-1', ?, ?)").run(specificationJson(row), NOW)
    sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ? WHERE selection_id = 'tile'").run(specificationJson(row))
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', room_name = 'Pantry' WHERE id = 'tile'")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "staff" }, staff: true, actorName: "Pat PM" })
    const tile = (await getSelectionWorkspace("p1", "staff")).items.find((item) => item.id === "tile")
    expect(tile?.links[0]?.current).toBe(true)
  })
})
