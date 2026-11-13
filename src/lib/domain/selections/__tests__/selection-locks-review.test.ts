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
import { deleteSelectionChoice, getSelectionDetail, getSelectionSheet, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { publishSelectionDecision } from "@/app/actions/selection-decisions"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { ownerChangedSelectionAfterApproval, ownerChangedSelectionAfterPurchase, replaceInstalledSelection } from "@/app/actions/selection-replacements"
import { sendRoundForSignature } from "@/app/actions/selection-round-signing"
import { assignSelectionRound } from "@/app/actions/selection-templates"
import { dailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { setSelectionChoiceChosen as setChosenRow, updateSelectionChoice } from "@/lib/domain/selections/choices-store"
import { supplierCouldntFillSelection } from "@/app/actions/selection-replacements"
import { updateProjectSelectionStatus } from "@/app/actions/project-selections"
import { advanceSelectionsForPurchaseOrder } from "@/lib/domain/selections/status-advance"
import { getRoundSigning } from "@/app/actions/selection-round-signing"
import { getOwnerChoiceBoard } from "@/app/actions/selection-choices"
import { addSelectionLink } from "@/app/actions/selection-choices"
import { selectionSettingsSchema } from "@/lib/feature-settings/selection-settings"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { specificationJson } from "@/lib/selections/decisions"
import { projectFinishSelections } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { createReplacementTodo } from "@/app/actions/selection-replacements"
import { insertReplacementSelectionStatement } from "@/lib/domain/selections/store"
import { findRoundSignatureByEnvelope, handleRoundSignatureEvent } from "@/lib/domain/selections/round-signing"

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

async function installedTileReplacedBySubway(): Promise<{ readonly hex: string; readonly subway: string; readonly replacementId: string; readonly todoId: string | null }> {
  const hex = await choice("tile", "Hex", "4185")
  const subway = await choice("tile", "Subway", "3200")
  await setSelectionChoiceChosen("p1", hex, true)
  sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
  const done = await replaceInstalledSelection("p1", "tile", subway, null)
  if (!done.success) throw new Error(done.error)
  return { hex, subway, replacementId: done.data.selectionId, todoId: done.data.todoId }
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
    // Outside roles are dropped from the setting.
    expect(selectionSettingsSchema.parse({ ...FEATURE_SETTINGS.selections.defaults, priceChangeNoticeRoles: ["client"] }).priceChangeNoticeRoles).toEqual([])
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

  it("11: a replacement carries follow-up links", async () => {
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
    // The replaced selection stays on record.
    expect(await deleteProjectSelection("p1", "tile")).toMatchObject({ success: false })
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

  it("R2-7 + R2-10: replaced rows are hidden from partners, marked on the owner board, and refuse links in the write", async () => {
    await installedTileReplacedBySubway()
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 1 WHERE id = 'tile'")
    const db = drizzleOverSqlite(sqlite)
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "vendor" }, staff: false, actorName: "Vendor" })
    expect((await getSelectionWorkspace("p1", "sub_vendor")).items.map((item) => item.id)).not.toContain("tile")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
    const board = await getOwnerChoiceBoard("p1")
    expect(board.find((item) => item.id === "tile")?.replacedByName).toBe("Backsplash")
    expect(await addSelectionLink("p1", "tile", null, "https://example.com/x")).toMatchObject({ success: false })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_links WHERE selection_id = 'tile'").get()).toEqual({ n: 0 })
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

  it("R4-6: an order the supplier couldn't fill can be replaced (also a replacement), with a change-order to-do and no change order", async () => {
    const { replacementId } = await installedTileReplacedBySubway()
    sqlite.exec(`UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1 WHERE id = '${replacementId}'`)
    expect(await updateProjectSelectionStatus("p1", replacementId, "unavailable", "ordered")).toMatchObject({ success: true })
    const detail = await getSelectionDetail("p1", replacementId)
    expect(detail.success && detail.data.canReplaceUnfilled).toBe(true)
    const hexCopy = (sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = ? AND title = 'Hex'").get(replacementId) as { id: string }).id
    const done = await supplierCouldntFillSelection("p1", replacementId, hexCopy, "discontinued")
    if (!done.success) throw new Error(done.error)
    // Nothing writes change-order lines; staff write the change order from the to-do.
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_change_order_lines").get()).toEqual({ n: 0 })
    expect(done.data.todoId).not.toBeNull()
    expect(await supplierCouldntFillSelection("p1", "faucet", null, null)).toMatchObject({ success: false })
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

  it("R5-1 + R5-11: an imported (unsigned) approval is never cleared by edits, publishing or the workbook", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, approved_at = '2026-01-01', source_system = 'buildertrend' WHERE id = 'tile'")
    const approved = () => sqlite.prepare("SELECT owner_approved AS a, approved_at AS at FROM project_finish_selections WHERE id = 'tile'").get()
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "approved", model: "HX-2" })).toMatchObject({ success: true })
    expect(approved()).toEqual({ a: 1, at: "2026-01-01" })
    const row = sqlite.prepare("SELECT updated_at AS updatedAt FROM project_finish_selections WHERE id = 'tile'").get() as { updatedAt: string }
    mocks.audience.mockResolvedValueOnce({ db: drizzleOverSqlite(sqlite), user: { id: "staff" }, staff: true, actorName: "Pat PM" })
    expect(
      await publishSelectionDecision("p1", { selectionId: "tile", expectedRevision: 1, selectionUpdatedAt: row.updatedAt, published: true, decisionDueDate: "", allowance: "3200", price: "4185", scheduleImpact: "None", ownerNote: "", requiresChangeOrder: false, changeOrderId: "" }),
    ).toMatchObject({ success: true })
    expect(approved()).toEqual({ a: 1, at: "2026-01-01" })
    // Still outside the phase: nothing billed twice.
    const view = await getRoundSigning("p1", "rough-in")
    expect(view.success && view.data.document.lines.map((line) => line.selectionId)).not.toContain("tile")
    // The approved pick's price is what was approved: read-only.
    expect(await saveSelectionChoice("p1", "tile", hex, { title: "Hex", price: "1", ownerPrice: "5000" })).toMatchObject({ success: false })
  })

  it("R7: a material edit on a signed selection keeps its approval: never back into a Selection Phase; staff review the change order impact", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    sqlite.exec(`
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('sig', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig', 'tile', '${hex}', 'Hex');
      UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, approved_at = '${NOW}' WHERE id = 'tile';
    `)
    expect(await updateProjectSelection("p1", "tile", { ...base, status: "approved", model: "HX-2" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status, owner_approved AS a, approved_at AS at, model FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "approved", a: 1, at: NOW, model: "HX-2" })
    // Not signed or billed again by the next Selection Phase document.
    const view = await getRoundSigning("p1", "rough-in")
    if (!view.success) throw new Error(view.error)
    expect(view.data.document.toSign.map((line) => line.selectionId)).toEqual(["faucet"])
    // Staff get the change order review instead.
    expect(
      sqlite.prepare("SELECT source_record_type AS kind FROM project_operations WHERE source_record_id = 'tile' AND source_record_type = 'selection_change_order_review'").all(),
    ).toEqual([{ kind: "selection_change_order_review" }])
  })

  it("R5-1: the workbook leaves an imported approval alone (a conflict for staff)", async () => {
    const { applyFinishScheduleImport } = await import("@/lib/domain/selections/finish-schedule-import")
    expect(applyFinishScheduleImport).toBeTypeOf("function")
    // The import goes through the shared helper, and counts a change to an approved row as a conflict.
    const source = readFileSync("src/lib/domain/selections/finish-schedule-import.ts", "utf8")
    expect(source).toContain("approvalNeedsReview && existing.ownerApproved")
    expect(source).toContain("clearApprovalPatch(")
    for (const file of ["src/app/actions/project-selections.ts", "src/app/actions/selection-decisions.ts", "src/lib/domain/selections/finish-schedule-import.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/ownerApproved: false,\s*approvedBy: null/)
    }
  })

  it("R5-8 + R5-9: no pick on an approved selection, checked in the write; back to Ordered clears the release", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 1 WHERE id = 'tile'")
    expect(await setChosenRow(drizzleOverSqlite(sqlite), "tile", subway, true, NOW, { userId: "owner", audience: "owner", note: null })).toBe(false)
    expect(await setChosenRow(drizzleOverSqlite(sqlite), "tile", subway, true, NOW, { userId: "staff", audience: "staff", note: null })).toBe(false)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")
    expect(await updateProjectSelectionStatus("p1", "tile", "unavailable", "ordered")).toMatchObject({ success: true })
    expect(await updateProjectSelectionStatus("p1", "tile", "ordered", "unavailable")).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT procurement_released_at AS released FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ released: null })
  })

  it("R6: an approved selection (signed, or an imported Buildertrend approval) refuses pick changes from staff and the owner", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, source_system = 'buildertrend' WHERE id = 'tile'")
    const approved = { success: false, error: "This selection is approved. Use a change order to change it." }
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject(approved)
    expect(await setSelectionChoiceChosen("p1", hex, false)).toMatchObject(approved)
    expect(await setSelectionChoiceChosen("p1", subway, true, "owner")).toMatchObject(approved)
    expect(sqlite.prepare("SELECT id FROM project_selection_choices WHERE selection_id = 'tile' AND chosen = 1").all()).toEqual([{ id: hex }])
    // Un-picking a choice that isn't the pick changes nothing.
    expect(await setSelectionChoiceChosen("p1", subway, false)).toMatchObject({ success: true })
    // A BT approval with nothing chosen is refused the same way.
    const brass = await choice("faucet", "Brass", "380")
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, source_system = 'buildertrend' WHERE id = 'faucet'")
    expect(await setSelectionChoiceChosen("p1", brass, true)).toMatchObject(approved)
    expect(await setSelectionChoiceChosen("p1", brass, true, "owner")).toMatchObject(approved)
  })

  it("R6: no pick changes while the selection's Selection Phase is out for signature, from staff or the owner", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    const out = { success: false, error: "This selection is out for signature." }
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject(out)
    expect(await setSelectionChoiceChosen("p1", subway, true, "owner")).toMatchObject(out)
    // Checked in the write too.
    expect(await setChosenRow(drizzleOverSqlite(sqlite), "tile", subway, true, NOW, { userId: "staff", audience: "staff", note: null })).toBe(false)
    // Cancelled: picks change again.
    sqlite.exec("UPDATE project_selection_round_signatures SET status = 'cancelled'")
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: true })
  })

  it("R4-5: Ordered → Unavailable lets go of the old purchase order (kept on record)", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec(`
      INSERT INTO project_operations (id, project_id, source_record_type, title, created_at, updated_at) VALUES ('po-1', 'p1', 'purchase_order', 'Tile PO', '2026-11-01T00:00:00.000Z', '${NOW}');
      INSERT INTO project_selection_procurement_links (id, project_id, selection_id, operation_id, specification_json, created_at) VALUES ('pl', 'p1', 'tile', 'po-1', '{}', '2026-11-01T00:00:00.000Z');
      UPDATE project_finish_selections SET status = 'ordered', purchase_order_operation_id = 'po-1' WHERE id = 'tile';
    `)
    expect(await updateProjectSelectionStatus("p1", "tile", "unavailable", "ordered")).toMatchObject({ success: true })
    const row = sqlite.prepare("SELECT purchase_order_operation_id AS po, procurement_released_at AS released FROM project_finish_selections WHERE id = 'tile'").get() as { po: string | null; released: string | null }
    expect(row.po).toBeNull()
    expect(row.released).not.toBeNull()
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_procurement_links").get()).toEqual({ n: 1 })
    // Back with the owner, the old purchase order can't move it to Ordered again.
    sqlite.exec("UPDATE project_finish_selections SET status = 'owner_review' WHERE id = 'tile'")
    const actor = { id: "staff", email: "pm@example.com", displayName: "Pat PM", firstName: null, lastName: null, role: "project_manager" }
    expect(await advanceSelectionsForPurchaseOrder(drizzleOverSqlite(sqlite), { projectId: "p1", purchaseOrderId: "po-1", purchaseOrderNumber: "PO-1", status: "sent", actor })).toEqual([])
  })

  it("R8-2: an approved selection not yet ordered can be replaced ('Owner changed after approval') with a change-order to-do", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    // Not approved yet: the pick just changes, no replacement.
    expect(await ownerChangedSelectionAfterApproval("p1", "tile", subway, null)).toMatchObject({ success: false, error: expect.stringMatching(/approved selection/) })
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, source_system = 'buildertrend' WHERE id = 'tile'")
    const detail = await getSelectionDetail("p1", "tile")
    expect(detail.success && detail.data.canReplaceApproved).toBe(true)
    const done = await ownerChangedSelectionAfterApproval("p1", "tile", subway, "prefers the subway tile")
    if (!done.success) throw new Error(done.error)
    expect(sqlite.prepare("SELECT status, owner_approved AS a FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "approved", a: 1 })
    expect(sqlite.prepare("SELECT replacement_reason AS reason, status FROM project_finish_selections WHERE id = ?").get(done.data.selectionId)).toEqual({ reason: "owner_changed_after_approval", status: "proposed" })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_change_orders").get()).toEqual({ n: 0 })
    expect(sqlite.prepare("SELECT assignee_name AS assignee, json_extract(sage_payload_json, '$.replacedSelectionId') AS replaced FROM project_operations WHERE id = ?").get(done.data.todoId)).toEqual({ assignee: "Pat PM", replaced: "tile" })
    // Ordered ones go through "Owner changed after purchase" instead.
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", brass, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered', owner_approved = 1 WHERE id = 'faucet'")
    expect(await ownerChangedSelectionAfterApproval("p1", "faucet", null, null)).toMatchObject({ success: false })
  })

  it("R8-1: the change-order to-do goes to the project manager, else the next role (APM, then project administrator)", async () => {
    sqlite.exec("DELETE FROM project_members WHERE user_id = 'staff'")
    const { todoId } = await installedTileReplacedBySubway()
    expect(sqlite.prepare("SELECT assignee_name AS assignee FROM project_operations WHERE id = ?").get(todoId)).toEqual({ assignee: "Ari APM" })
  })

  it("R8-3: an unsigned ordered selection with a pick stays in the Selection Phase and is billed; without a pick it's left out", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id IN ('tile', 'faucet')")
    const view = await getRoundSigning("p1", "rough-in")
    if (!view.success) throw new Error(view.error)
    expect(view.data.document.toSign.map((line) => ({ id: line.selectionId, delta: line.deltaCents }))).toEqual([{ id: "tile", delta: 418500 - 320000 }])
    expect(view.data.document.lines.map((line) => line.selectionId)).not.toContain("faucet")
  })

  it("R8-4: out for signature, choices change only in price, and neither choices nor the selection can be deleted", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "tile", subway, { title: "Subway tile", price: "1", ownerPrice: "3200" })).toMatchObject({ success: false, error: expect.stringMatching(/out for signature/) })
    expect(await saveSelectionChoice("p1", "tile", subway, { title: "Subway", price: "1", ownerPrice: "3300" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT title, owner_price_cents AS price FROM project_selection_choices WHERE id = ?").get(subway)).toEqual({ title: "Subway", price: 330000 })
    expect(await deleteSelectionChoice("p1", subway)).toMatchObject({ success: false, error: expect.stringMatching(/out for signature/) })
    // Deleting the selection itself is refused while it is out (the guard also applies in the write).
    const { selectionDeletionAllowed } = await import("@/lib/selections/deletion")
    sqlite.exec("UPDATE project_selection_decisions SET published = 0 WHERE selection_id = 'tile'")
    expect(await drizzleOverSqlite(sqlite).delete(projectFinishSelections).where(and(eq(projectFinishSelections.id, "tile"), selectionDeletionAllowed("tile"))).returning()).toHaveLength(0)
    sqlite.exec("UPDATE project_selection_round_signatures SET status = 'cancelled'")
    expect(await deleteSelectionChoice("p1", subway)).toMatchObject({ success: true })
  })

  it("R8-5: the owner board doesn't offer choices on ordered, approved or out-for-signature selections", async () => {
    const db = drizzleOverSqlite(sqlite)
    for (const id of ["tile", "faucet"]) {
      const row = await db.select().from(projectFinishSelections).where(eq(projectFinishSelections.id, id)).get()
      if (!row) throw new Error("no row")
      sqlite.prepare("UPDATE project_selection_decisions SET specification_json = ? WHERE selection_id = ?").run(specificationJson(row), id)
    }
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'")
    mocks.audience.mockResolvedValueOnce({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
    const board = await getOwnerChoiceBoard("p1")
    expect(Object.fromEntries(board.map((item) => [item.id, item.pickFixed]))).toEqual({ tile: "ordered", faucet: null })
  })

  it("R8-6: a bad notice role is dropped, never the whole Selections setting; the workbook reopen waits on no owner approval", async () => {
    const { parseFeatureSettings } = await import("@/lib/feature-settings/registry")
    const parsed = parseFeatureSettings(
      "selections",
      JSON.stringify({ ...FEATURE_SETTINGS.selections.defaults, rounds: [{ id: "only", name: "Only", scheduleItem: "", bufferDays: 7 }], priceChangeNoticeRoles: ["client", "project_manager", "not_a_role"] }),
    )
    expect(parsed.rounds.map((round) => round.id)).toEqual(["only"])
    expect(parsed.priceChangeNoticeRoles).toEqual(["project_manager"])
    const source = readFileSync("src/lib/domain/selections/finish-schedule-import.ts", "utf8")
    expect(source).toContain("and(stillUnlocked, eq(projectFinishSelections.ownerApproved, false))")
  })

  it("R9-1: no replacement while the Selection Phase is out for signature (checked in the write); signing skips a replaced selection", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 1 WHERE id = 'tile'")
    expect(await ownerChangedSelectionAfterApproval("p1", "tile", subway, null)).toMatchObject({ success: false, error: "This selection is out for signature." })
    const detail = await getSelectionDetail("p1", "tile")
    expect(detail.success && detail.data.canReplaceApproved).toBe(false)
    // The write refuses it even after a stale read.
    const db = drizzleOverSqlite(sqlite)
    const insert = (id: string) =>
      insertReplacementSelectionStatement(db, { id, projectId: "p1", replacesSelectionId: "tile", expected: "approved", reason: "owner_changed_after_approval", status: "proposed", notes: "", now: NOW })
    const [stale] = await db.batch([insert("r-stale")])
    expect(stale.meta.changes).toBe(0)
    // A replacement made anyway (say, before the guard) isn't approved by the signature.
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 0, status = 'owner_review' WHERE id = 'tile'")
    sqlite.exec(`INSERT INTO project_finish_selections (id, project_id, room_name, name, category, replaces_selection_id, created_at, updated_at) VALUES ('r-raw', 'p1', 'Kitchen', 'Backsplash', 'Tile', 'tile', '${NOW}', '${NOW}')`)
    const signature = await findRoundSignatureByEnvelope(db, "env-1")
    if (!signature) throw new Error("no signature")
    const { env } = await mocks.staff()
    expect(await handleRoundSignatureEvent({ db, env, signature, event: "folder_executed" })).toBe(true)
    expect(sqlite.prepare("SELECT id, owner_approved AS a FROM project_finish_selections WHERE id IN ('tile', 'faucet') ORDER BY id").all()).toEqual([
      { id: "faucet", a: 1 },
      { id: "tile", a: 0 },
    ])
  })

  it("R9-2: a failed to-do still makes the replacement, with a warning; its drawer makes the to-do", async () => {
    sqlite.exec("CREATE TRIGGER no_todos BEFORE INSERT ON project_operations WHEN NEW.source_record_type = 'staff_task' BEGIN SELECT RAISE(ABORT, 'to-do insert failed'); END")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { replacementId, todoId } = await installedTileReplacedBySubway()
    expect(todoId).toBeNull()
    expect(sqlite.prepare("SELECT replaces_selection_id AS r FROM project_finish_selections WHERE id = ?").get(replacementId)).toEqual({ r: "tile" })
    const before = await getSelectionDetail("p1", replacementId)
    expect(before.success && before.data.needsReplacementTodo).toBe(true)
    sqlite.exec("DROP TRIGGER no_todos")
    const made = await createReplacementTodo("p1", replacementId)
    if (!made.success) throw new Error(made.error)
    expect(sqlite.prepare("SELECT title, assignee_name AS assignee, json_extract(sage_payload_json, '$.replacedSelectionId') AS replaced FROM project_operations WHERE id = ?").get(made.data.todoId)).toEqual({
      title: expect.stringMatching(/change order/),
      assignee: "Pat PM",
      replaced: "tile",
    })
    const after = await getSelectionDetail("p1", replacementId)
    expect(after.success && after.data.needsReplacementTodo).toBe(false)
    // Once open, no second one.
    expect(await createReplacementTodo("p1", replacementId)).toMatchObject({ success: true, data: { todoId: null } })
  })

  it("R9-2: the warning reaches the caller when the to-do fails", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    await setSelectionChoiceChosen("p1", hex, true)
    sqlite.exec("UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'")
    sqlite.exec("CREATE TRIGGER no_todos BEFORE INSERT ON project_operations WHEN NEW.source_record_type = 'staff_task' BEGIN SELECT RAISE(ABORT, 'to-do insert failed'); END")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await replaceInstalledSelection("p1", "tile", subway, null)).toMatchObject({ success: true, data: { todoId: null, todoWarning: expect.stringMatching(/Create change-order to-do/) } })
  })

  it("R9-3: 'Owner changed after approval' lands only while the row is still approved or its pick signed", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec("UPDATE project_finish_selections SET status = 'approved', owner_approved = 0 WHERE id = 'tile'")
    const insert = (id: string) =>
      insertReplacementSelectionStatement(db, { id, projectId: "p1", replacesSelectionId: "tile", expected: "approved", reason: "owner_changed_after_approval", status: "proposed", notes: "", now: NOW })
    const [unapproved] = await db.batch([insert("r-1")])
    expect(unapproved.meta.changes).toBe(0)
    sqlite.exec("UPDATE project_finish_selections SET owner_approved = 1 WHERE id = 'tile'")
    const [approved] = await db.batch([insert("r-2")])
    expect(approved.meta.changes).toBe(1)
  })

  it("R9-4: with no project manager, APM or project administrator, the to-do goes to the company's first active administrator, never free text", async () => {
    sqlite.exec(`
      DELETE FROM project_members WHERE user_id IN ('staff', 'apm', 'admin-pa');
      UPDATE projects SET project_manager = 'Someone Typed' WHERE id = 'p1';
      INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
        ('boss', 'boss@example.com', 'Bea Boss', 'admin', 1, '${NOW}', '${NOW}'),
        ('late', 'late@example.com', 'Lee Late', 'admin', 1, '${NOW}', '${NOW}'),
        ('old', 'old@example.com', 'Ola Old', 'admin', 0, '${NOW}', '${NOW}');
      INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
        ('om-old', 'org-1', 'old', 'admin', '2020-01-01T00:00:00.000Z'),
        ('om-boss', 'org-1', 'boss', 'admin', '2021-01-01T00:00:00.000Z'),
        ('om-late', 'org-1', 'late', 'admin', '2025-01-01T00:00:00.000Z');
    `)
    const { todoId } = await installedTileReplacedBySubway()
    expect(sqlite.prepare("SELECT assignee_name AS assignee FROM project_operations WHERE id = ?").get(todoId)).toEqual({ assignee: "Bea Boss" })
  })

  it("R9-4: with no manager and no administrator the to-do is unassigned, not the typed project manager", async () => {
    sqlite.exec("DELETE FROM project_members WHERE user_id IN ('staff', 'apm', 'admin-pa'); UPDATE projects SET project_manager = 'Someone Typed' WHERE id = 'p1'")
    const { todoId } = await installedTileReplacedBySubway()
    expect(sqlite.prepare("SELECT assignee_name AS assignee FROM project_operations WHERE id = ?").get(todoId)).toEqual({ assignee: null })
  })

  it("R9-5: deleting a replacement archives its open change-order to-do", async () => {
    const { replacementId, todoId } = await installedTileReplacedBySubway()
    expect(await deleteProjectSelection("p1", replacementId)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status FROM project_operations WHERE id = ?").get(todoId)).toEqual({ status: "archived" })
  })

  it("R9-6: no draft change-order start or replacement setting is left", () => {
    expect(readFileSync("src/lib/domain/selections/selection-change-orders.ts", "utf8")).not.toMatch(/kind: "draft"/)
    expect(readFileSync("src/components/selections/selection-replace-dialog.tsx", "utf8")).not.toMatch(/company setting/)
    expect(readFileSync("docs/help/guides/finish-selections.md", "utf8")).not.toMatch(/executed change order/)
  })
})
