import Database from "better-sqlite3"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyMigrations } from "@/test/migrated-database"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Owner-suggested choices (owner decision 2026-11-13), against a database
 * built from every migration: "Add my own choice" with a product link,
 * "Suggested by owner" and "Pending staff pricing" (the website price is
 * never the owner price), staff pricing clearing it, the PM's pricing to-do
 * (idempotent, admin fallback), the locks checked inside the write, owners
 * editing or deleting only their own suggestions until staff price them, the
 * company setting, and no signature while a picked choice is pending.
 */

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  audience: vi.fn(),
  preview: vi.fn(),
  envelope: vi.fn(),
  context: vi.fn(),
}))
vi.mock("@/lib/server/action-context", async (original) => ({ ...(await original<typeof import("@/lib/server/action-context")>()), projectContext: mocks.context }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/selections/link-preview", async (original) => {
  const actual = await original<typeof import("@/lib/selections/link-preview")>()
  return { ...actual, fetchLinkPreview: mocks.preview }
})
vi.mock("@/lib/foxit/esign", () => ({ createFoxitPreparedEnvelope: mocks.envelope, downloadFoxitExecutedEnvelope: vi.fn() }))
vi.mock("@/lib/esign/announce", () => ({ announceEsignOutcome: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({
  notifyProjectStaffOfOutsideEvent: vi.fn(),
  createNotificationEvent: vi.fn(),
  createSystemNotificationEvent: vi.fn(),
}))
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "session=abc" }), headers: async () => new Headers() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn(), canFeature: vi.fn(async () => true) }))

import { deleteSelectionChoice, getOwnerChoiceBoard, getSelectionChoicesPanel, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { addOwnerSuggestedChoice, deleteOwnerSuggestedChoice, updateOwnerSuggestedChoice } from "@/app/actions/selection-owner-choices"
import { sendRoundForSignature } from "@/app/actions/selection-round-signing"
import {
  deleteOwnerSuggestedChoice as deleteSuggestionRow,
  insertOwnerSuggestedChoice,
  setChoicePricesFromRfq,
  updateOwnerSuggestedChoice as updateSuggestionRow,
} from "@/lib/domain/selections/choices-store"
import { archivePricedSuggestionTodos, ensureOwnerSuggestionTodo } from "@/lib/domain/selections/owner-suggestions"
import {
  ownerCanChangeSuggestion,
  parseOwnerSuggestion,
  pendingPricingBlocker,
} from "@/lib/domain/selections/owner-suggestion-rules"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { selectionSettingsSchema } from "@/lib/feature-settings/selection-settings"
import { buildRoundDocument } from "@/lib/selections/round-document"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-13T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const db = new Database(":memory:")
    applyMigrations((sql) => db.exec(sql))
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
      ('admin', 'admin@example.com', 'Ada Admin', 'admin', 1, '${NOW}', '${NOW}'),
      ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}'),
      ('owner-2', 'owner2@example.com', 'Otto Owner', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_number, contract_type, created_at) VALUES ('p1', 'Job', 'org-1', 'O-1', 'fixed_price', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('om-admin', 'org-1', 'admin', 'admin', '${NOW}'),
      ('om-staff', 'org-1', 'staff', 'project_manager', '${NOW}'),
      ('om-owner', 'org-1', 'owner', 'client', '${NOW}'),
      ('om-owner-2', 'org-1', 'owner-2', 'client', '${NOW}');
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
      ('m1', 'p1', 'staff', 'project_manager', '${NOW}'),
      ('m2', 'p1', 'owner', 'client', '${NOW}'),
      ('m3', 'p1', 'owner-2', 'client', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, primary_contact, created_at, updated_at)
      VALUES ('pc1', 'p1', 'owner', 'Olive Owner', 'owner@example.com', 1, '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, category, cost_code, round_key, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'Tile', '09 30 00', 'rough-in', '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Kitchen', 'Faucet', 'Plumbing', '22 40 00', 'rough-in', '${NOW}', '${NOW}'),
      ('hidden', 'p1', 'Kitchen', 'Not published', 'Tile', '09 30 00', NULL, '${NOW}', '${NOW}');
    INSERT INTO project_selection_decisions (selection_id, project_id, revision, published, specification_json, allowance_cents, last_mutation_id, updated_at) VALUES
      ('tile', 'p1', 1, 1, '{}', 320000, 'm1', '${NOW}'),
      ('faucet', 'p1', 1, 1, '{}', 50000, 'm2', '${NOW}');
    INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'selections', '{"rounds":[{"id":"rough-in","name":"Rough-in","scheduleItem":"","bufferDays":21}],"leadTimeDays":{},"ownerMarkupPercent":20,"changeOrderThresholdPercent":10}', '${NOW}');
  `)
}

function asOwner(id = "owner", name = "Olive Owner"): void {
  const db = drizzleOverSqlite(sqlite)
  mocks.audience.mockResolvedValue({ db, user: { id, email: `${id}@example.com`, displayName: name, role: "client" }, staff: false, actorName: name })
}

async function suggest(selectionId = "tile", input: Partial<{ name: string; url: string; note: string }> = {}): Promise<string> {
  const result = await addOwnerSuggestedChoice("p1", selectionId, { name: "Zellige", url: "https://tiles.example.com/zellige", note: "Like our friends' kitchen", ...input })
  if (!result.success) throw new Error(result.error)
  return result.data.id
}

type ChoiceRow = {
  title: string
  description: string | null
  price_cents: number | null
  owner_price_cents: number | null
  suggested_by_user_id: string | null
  suggested_at: string | null
  owner_pricing_pending: number
  owner_priced_at: string | null
}

function choiceRow(id: string): ChoiceRow | undefined {
  return sqlite
    .prepare("SELECT title, description, price_cents, owner_price_cents, suggested_by_user_id, suggested_at, owner_pricing_pending, owner_priced_at FROM project_selection_choices WHERE id = ?")
    .get(id) as ChoiceRow | undefined
}

function todos(): { title: string; assignee_name: string | null; status: string; key: string | null }[] {
  return sqlite
    .prepare(
      "SELECT title, assignee_name, status, json_extract(sage_payload_json, '$.selectionStepKey') AS key FROM project_operations WHERE json_extract(sage_payload_json, '$.selectionStep') = 'price_owner_suggestion' ORDER BY title",
    )
    .all() as { title: string; assignee_name: string | null; status: string; key: string | null }[]
}

function outForSignature(selectionId: string): void {
  sqlite.exec(`
    INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, created_at, updated_at)
      VALUES ('sig-out', 'p1', 'rough-in', 'Rough-in', 'sent', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}');
    INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('sig-out', '${selectionId}', NULL, '');
  `)
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
  asOwner()
  mocks.preview.mockResolvedValue({ title: "Zellige white", imageUrl: "https://tiles.example.com/zellige.jpg", siteName: "Tile Shop", priceCents: 2899 })
  mocks.envelope.mockResolvedValue({ envelopeId: "env-1", embeddedSessionUrl: "https://foxit.example.com/send/1" })
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("owner-suggested choice rules", () => {
  it("parses a name, an optional link and a note", () => {
    expect(parseOwnerSuggestion({ name: "  Zellige ", url: "", note: "" })).toEqual({ ok: true, value: { title: "Zellige", url: null, description: null } })
    expect(parseOwnerSuggestion({ name: "", url: "", note: "" })).toMatchObject({ ok: false, error: "Give your choice a name." })
    expect(parseOwnerSuggestion({ name: "x", url: "javascript:alert(1)", note: "" })).toMatchObject({ ok: false })
    expect(parseOwnerSuggestion({ name: "x".repeat(201), url: "", note: "" })).toMatchObject({ ok: false })
  })

  it("lets only the suggester change a suggestion, while it is pending", () => {
    expect(ownerCanChangeSuggestion({ suggestedByViewer: true, ownerPricingPending: true })).toBe(true)
    expect(ownerCanChangeSuggestion({ suggestedByViewer: false, ownerPricingPending: true })).toBe(false)
    expect(ownerCanChangeSuggestion({ suggestedByViewer: true, ownerPricingPending: false })).toBe(false)
  })

  it("7: a phase document with a pending pick can't be signed, with a clear message", () => {
    const line = {
      selectionId: "tile",
      roomName: "Kitchen",
      selectionName: "Backsplash",
      choiceId: "c",
      choiceTitle: "Zellige",
      choiceDescription: null,
      photoId: null,
      linkUrl: null,
      linkSite: null,
      ownerPriceCents: null,
      allowanceCents: 100,
      costCode: null,
      pickedBy: null,
      signedEarlier: false,
      ownerPricingPending: true,
    }
    const message = 'Backsplash: the owner\'s suggested choice "Zellige" is still pending staff pricing. Set its owner price before sending for signature.'
    expect(pendingPricingBlocker([line])).toBe(message)
    expect(buildRoundDocument([line], "fixed_price", 10).blocker).toBe(message)
    expect(buildRoundDocument([{ ...line, ownerPricingPending: false, ownerPriceCents: 100 }], "fixed_price", 10).blocker).toBeNull()
  })

  it("6: the company setting defaults on", () => {
    expect(FEATURE_SETTINGS.selections.defaults.ownerSuggestedChoices).toBe(true)
    expect(selectionSettingsSchema.parse({ ...FEATURE_SETTINGS.selections.defaults, ownerSuggestedChoices: false }).ownerSuggestedChoices).toBe(false)
  })
})

describe("owner-suggested choices", () => {
  it("1 + 2: adds the owner's choice with its link, image and supplier price; the website price never becomes the owner price", async () => {
    const id = await suggest()
    // Markup is 20% in Settings, but nothing fills the owner price from the website price.
    expect(choiceRow(id)).toEqual({
      title: "Zellige",
      description: "Like our friends' kitchen",
      price_cents: 2899,
      owner_price_cents: null,
      suggested_by_user_id: "owner",
      suggested_at: expect.any(String),
      owner_pricing_pending: 1,
      owner_priced_at: null,
    })
    expect(sqlite.prepare("SELECT url, image_url, price_cents, added_by_user_id, added_by_audience FROM project_selection_links WHERE choice_id = ?").get(id)).toEqual({
      url: "https://tiles.example.com/zellige",
      image_url: "https://tiles.example.com/zellige.jpg",
      price_cents: 2899,
      added_by_user_id: "owner",
      added_by_audience: "owner",
    })
    const board = await getOwnerChoiceBoard("p1")
    const card = board.find((selection) => selection.id === "tile")?.panel.choices.find((choice) => choice.id === id)
    expect(card).toMatchObject({ suggestedByOwner: true, suggestedByViewer: true, ownerPricingPending: true, ownerPriceCents: null, priceCents: null, suggestedByName: null })
    // The owner can pick it like any other choice.
    expect(await setSelectionChoiceChosen("p1", id, true, "owner")).toMatchObject({ success: true })
    // Without a link: no link, no supplier price.
    const plain = await suggest("faucet", { name: "Bridge faucet", url: "" })
    expect(choiceRow(plain)).toMatchObject({ price_cents: null, owner_pricing_pending: 1 })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_links WHERE choice_id = ?").get(plain)).toEqual({ n: 0 })
  })

  it("2: only an owner price staff type in clears pending (the markup never fills it from the website price); its to-do is archived", async () => {
    const id = await suggest()
    // Staff see who suggested it, the supplier price, and that it waits for them.
    const panel = await getSelectionChoicesPanel("p1", "tile")
    if (!panel.success) throw new Error(panel.error)
    expect(panel.data.choices.find((choice) => choice.id === id)).toMatchObject({ suggestedByOwner: true, suggestedByName: "Olive Owner", ownerPricingPending: true, priceCents: 2899 })
    // A save with the owner price blank: the 20% markup does NOT fill it in; still pending, to-do still open.
    expect(await saveSelectionChoice("p1", "tile", id, { title: "Zellige", price: "28.99", ownerPrice: "" })).toMatchObject({ success: true })
    expect(choiceRow(id)).toMatchObject({ price_cents: 2899, owner_price_cents: null, owner_pricing_pending: 1, owner_priced_at: null })
    expect(todos().find((todo) => todo.title.includes("Zellige"))?.status).toBe("open")
    // Staff type the owner price: priced, and the pricing to-do is archived.
    expect(await saveSelectionChoice("p1", "tile", id, { title: "Zellige", price: "28.99", ownerPrice: "41.50" })).toMatchObject({ success: true })
    expect(choiceRow(id)).toMatchObject({ owner_price_cents: 4150, owner_pricing_pending: 0, owner_priced_at: expect.any(String) })
    expect(todos().find((todo) => todo.title.includes("Zellige"))?.status).toBe("archived")
    // A choice staff made (not a suggestion) still gets the markup.
    const staffMade = await saveSelectionChoice("p1", "tile", null, { title: "Staff tile", price: "10" })
    if (!staffMade.success) throw new Error(staffMade.error)
    expect(choiceRow(staffMade.data.id)).toMatchObject({ owner_price_cents: 1200, owner_pricing_pending: 0 })

    const other = await suggest("faucet", { name: "Bridge faucet" })
    // A supplier's RFQ quote (not the website) with the markup prices it; its to-do is archived in the same flow.
    await setChoicePricesFromRfq(drizzleOverSqlite(sqlite), "p1", [{ choiceId: other, selectionId: "faucet", priceCents: 10000 }], null, NOW, 20)
    expect(choiceRow(other)).toMatchObject({ owner_price_cents: 12000, owner_pricing_pending: 0, owner_priced_at: NOW })
    await archivePricedSuggestionTodos(drizzleOverSqlite(sqlite), "p1", [{ choiceId: other, selectionId: "faucet" }], NOW)
    expect(todos().find((todo) => todo.title.includes("Bridge faucet"))?.status).toBe("archived")
    // An RFQ price without a markup leaves the owner price empty: still pending.
    sqlite.exec("UPDATE project_selection_choices SET owner_price_cents = NULL, owner_pricing_pending = 1, owner_priced_at = NULL WHERE id = '" + other + "'")
    await setChoicePricesFromRfq(drizzleOverSqlite(sqlite), "p1", [{ choiceId: other, selectionId: "faucet", priceCents: 10000 }], null, NOW, null)
    expect(choiceRow(other)).toMatchObject({ owner_price_cents: null, owner_pricing_pending: 1 })
  })

  it("3: makes one pricing to-do per suggestion for the job's PM, idempotently, else the first active admin", async () => {
    const zellige = await suggest()
    await suggest("tile", { name: "Subway", url: "" })
    expect(todos()).toEqual([
      { title: "Price owner's suggested choice: Backsplash — Subway", assignee_name: "Pat PM", status: "open", key: expect.any(String) },
      { title: "Price owner's suggested choice: Backsplash — Zellige", assignee_name: "Pat PM", status: "open", key: `owner-suggestion:${zellige}` },
    ])
    const db = drizzleOverSqlite(sqlite)
    const again = { projectId: "p1", organizationId: "org-1", selectionId: "tile", selectionName: "Backsplash", choiceId: zellige, choiceTitle: "Zellige", actorId: "owner", now: NOW }
    expect(await ensureOwnerSuggestionTodo(db, again)).toBeNull()
    // Finished: still not made again.
    sqlite.exec("UPDATE project_operations SET status = 'done'")
    expect(await ensureOwnerSuggestionTodo(db, again)).toBeNull()
    expect(todos()).toHaveLength(2)
    // No selection manager on the job: the company's first active admin.
    sqlite.exec("DELETE FROM project_members WHERE id = 'm1'")
    await suggest("faucet", { name: "Bridge faucet", url: "" })
    expect(todos().find((todo) => todo.title.includes("Bridge faucet"))?.assignee_name).toBe("Ada Admin")
  })

  it("4: refuses inside the write when out for signature, approved, signed, ordered, installed or replaced", async () => {
    const db = drizzleOverSqlite(sqlite)
    const row = (id: string) => ({
      id,
      projectId: "p1",
      selectionId: "tile",
      title: "Sneaky",
      status: "proposed" as const,
      sortOrder: 9,
      suggestedByUserId: "owner",
      suggestedAt: NOW,
      ownerPricingPending: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const link = (id: string, choiceId: string) => ({ id, projectId: "p1", selectionId: "tile", choiceId, url: "https://x.example.com", addedByUserId: "owner", addedByAudience: "owner" as const, createdAt: NOW })
    expect(await insertOwnerSuggestedChoice(db, row("ok"), link("l-ok", "ok"))).toBe(true)

    const cases: readonly [string, string][] = [
      ["ordered", "UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'"],
      ["installed", "UPDATE project_finish_selections SET status = 'installed' WHERE id = 'tile'"],
      ["approved", "UPDATE project_finish_selections SET owner_approved = 1 WHERE id = 'tile'"],
      ["confirmed", `UPDATE project_selection_decisions SET approved_at = '${NOW}' WHERE selection_id = 'tile'`],
      ["unpublished", "UPDATE project_selection_decisions SET published = 0 WHERE selection_id = 'tile'"],
      [
        "replaced",
        `INSERT INTO project_finish_selections (id, project_id, room_name, name, replaces_selection_id, created_at, updated_at) VALUES ('tile-2', 'p1', 'Kitchen', 'Backsplash (new)', 'tile', '${NOW}', '${NOW}')`,
      ],
      ["out for signature", "INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, created_at, updated_at) VALUES ('s', 'p1', 'rough-in', 'Rough-in', 'preparing', '[]', 0, 0, 0, 'none', '" + NOW + "', '" + NOW + "'); INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('s', 'tile', NULL, '')"],
    ]
    for (const [name, lock] of cases) {
      sqlite.exec("SAVEPOINT lock")
      sqlite.exec(lock)
      // The write itself refuses (a stale pre-read can't slip past) and keeps nothing.
      expect(await insertOwnerSuggestedChoice(db, row(`c-${name}`), link(`l-${name}`, `c-${name}`)), name).toBe(false)
      expect(choiceRow(`c-${name}`), name).toBeUndefined()
      expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_links WHERE id = ?").get(`l-${name}`), name).toEqual({ n: 0 })
      // The action refuses too, with the lock's message.
      expect((await addOwnerSuggestedChoice("p1", "tile", { name: "X", url: "", note: "" })).success, name).toBe(false)
      sqlite.exec("ROLLBACK TO lock")
      sqlite.exec("RELEASE lock")
    }

    // Signed: a signed Selection Phase covers the current pick.
    expect(await setSelectionChoiceChosen("p1", "ok", true)).toMatchObject({ success: true })
    sqlite.exec(`
      INSERT INTO project_selection_round_signatures (id, project_id, round_key, round_name_snapshot, status, signers_json_snapshot, allowance_cents, owner_total_cents, delta_cents, treatment, signed_at, created_at, updated_at)
        VALUES ('signed', 'p1', 'rough-in', 'Rough-in', 'signed', '[]', 0, 0, 0, 'none', '${NOW}', '${NOW}', '${NOW}');
      INSERT INTO project_selection_round_signature_items (signature_id, selection_id, choice_id, choice_title_snapshot) VALUES ('signed', 'tile', 'ok', 'Sneaky');
    `)
    expect(await insertOwnerSuggestedChoice(db, row("c-signed"), null)).toBe(false)
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "X", url: "", note: "" })).toMatchObject({ success: false, error: expect.stringMatching(/approved/) })
  })

  it("2: at most five pending suggestions per owner per selection, refused in the write", async () => {
    for (const name of ["A", "B", "C", "D", "E"]) await suggest("tile", { name, url: "" })
    const capped = { success: false, error: "You already have 5 suggestions waiting for your builder to price on this selection. Delete one, or wait until they are priced." }
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "F", url: "", note: "" })).toEqual(capped)
    // The write refuses on its own (a stale count can't slip past).
    const db = drizzleOverSqlite(sqlite)
    const row = { id: "sixth", projectId: "p1", selectionId: "tile", title: "F", status: "proposed" as const, sortOrder: 9, suggestedByUserId: "owner", suggestedAt: NOW, ownerPricingPending: true, createdAt: NOW, updatedAt: NOW }
    expect(await insertOwnerSuggestedChoice(db, row, null)).toBe(false)
    expect(choiceRow("sixth")).toBeUndefined()
    // Another owner and another selection have their own room.
    asOwner("owner-2", "Otto Owner")
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "Otto's", url: "", note: "" })).toMatchObject({ success: true })
    asOwner()
    expect(await addOwnerSuggestedChoice("p1", "faucet", { name: "F", url: "", note: "" })).toMatchObject({ success: true })
    // Once staff price one, the owner may add another.
    const first = sqlite.prepare("SELECT id FROM project_selection_choices WHERE title = 'A'").get() as { id: string }
    expect(await saveSelectionChoice("p1", "tile", first.id, { title: "A", ownerPrice: "100" })).toMatchObject({ success: true })
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "F", url: "", note: "" })).toMatchObject({ success: true })
  })

  it("3: a failed pricing to-do is logged; the owner's choice is saved and reported saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    // The to-do write fails (no operations table).
    sqlite.exec("PRAGMA foreign_keys = OFF; DROP TABLE project_operations;")
    const result = await addOwnerSuggestedChoice("p1", "tile", { name: "Zellige", url: "", note: "" })
    expect(result).toMatchObject({ success: true })
    if (result.success) expect(choiceRow(result.data.id)).toMatchObject({ title: "Zellige", owner_pricing_pending: 1 })
    expect(logged).toHaveBeenCalledWith("Unable to create the pricing to-do for an owner's suggested choice", expect.objectContaining({ selectionId: "tile" }))
    logged.mockRestore()
  })

  it("4: only owners on a published selection; a staff preview can't add one", async () => {
    expect(await addOwnerSuggestedChoice("p1", "hidden", { name: "X", url: "", note: "" })).toEqual({ success: false, error: "Selection not found" })
    mocks.audience.mockRejectedValueOnce(new Error("Preview mode cannot record an owner's decision."))
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "X", url: "", note: "" })).toEqual({ success: false, error: "Preview mode cannot record an owner's decision." })
    expect(mocks.audience).toHaveBeenLastCalledWith("p1", "owner", true)
  })

  it("5: owners edit or delete only their own suggestions, only until staff price them (compare-and-set)", async () => {
    const id = await suggest()
    // Another owner on the job can't.
    asOwner("owner-2", "Otto Owner")
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "Mine now", url: "", note: "" })).toMatchObject({ success: false })
    expect(await deleteOwnerSuggestedChoice("p1", id)).toMatchObject({ success: false })
    const db = drizzleOverSqlite(sqlite)
    expect(await updateSuggestionRow(db, { projectId: "p1", choiceId: id, userId: "owner-2", patch: { title: "Mine", description: null, updatedAt: NOW } })).toBe(false)
    expect(await deleteSuggestionRow(db, "p1", id, "owner-2")).toBe(false)

    // The suggester can: a new link replaces theirs and sets the supplier price again.
    asOwner()
    mocks.preview.mockResolvedValueOnce({ title: "Zellige green", imageUrl: null, siteName: "Tile Shop", priceCents: 3199 })
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "Zellige green", url: "https://tiles.example.com/green", note: "" })).toMatchObject({ success: true })
    expect(choiceRow(id)).toMatchObject({ title: "Zellige green", description: null, price_cents: 3199, owner_price_cents: null, owner_pricing_pending: 1 })
    expect(sqlite.prepare("SELECT url FROM project_selection_links WHERE choice_id = ?").all(id)).toEqual([{ url: "https://tiles.example.com/green" }])
    // A blank link removes it.
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "Zellige green", url: "", note: "" })).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT count(*) AS n FROM project_selection_links WHERE choice_id = ?").get(id)).toEqual({ n: 0 })

    // Once staff price it, the owner can't change or delete it.
    expect(await saveSelectionChoice("p1", "tile", id, { title: "Zellige green", price: "31.99", ownerPrice: "45" })).toMatchObject({ success: true })
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "Changed", url: "", note: "" })).toMatchObject({ success: false })
    expect(await deleteOwnerSuggestedChoice("p1", id)).toMatchObject({ success: false })
    expect(await updateSuggestionRow(db, { projectId: "p1", choiceId: id, userId: "owner", patch: { title: "Changed", description: null, updatedAt: NOW } })).toBe(false)
    expect(choiceRow(id)?.title).toBe("Zellige green")

    // Deleting a pending suggestion archives its pricing to-do.
    const other = await suggest("faucet", { name: "Bridge faucet", url: "" })
    expect(await deleteOwnerSuggestedChoice("p1", other)).toMatchObject({ success: true })
    expect(choiceRow(other)).toBeUndefined()
    expect(todos().find((todo) => todo.title.includes("Bridge faucet"))?.status).toBe("archived")
    // Staff deleting one archives it too.
    const third = await suggest("faucet", { name: "Wall faucet", url: "" })
    expect(await deleteSelectionChoice("p1", third)).toMatchObject({ success: true })
    expect(todos().find((todo) => todo.title.includes("Wall faucet"))?.status).toBe("archived")
  })

  it("5: no edits or deletes while the selection is out for signature", async () => {
    const id = await suggest()
    outForSignature("tile")
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "Changed", url: "", note: "" })).toMatchObject({ success: false })
    expect(await deleteOwnerSuggestedChoice("p1", id)).toMatchObject({ success: false })
    const db = drizzleOverSqlite(sqlite)
    expect(await updateSuggestionRow(db, { projectId: "p1", choiceId: id, userId: "owner", patch: { title: "Changed", description: null, updatedAt: NOW } })).toBe(false)
    expect(await deleteSuggestionRow(db, "p1", id, "owner")).toBe(false)
    expect(choiceRow(id)?.title).toBe("Zellige")
  })

  it("6: with the company setting off, the owner view hides the button and the server refuses", async () => {
    const id = await suggest()
    sqlite.exec("UPDATE organization_feature_settings SET value = json_set(value, '$.ownerSuggestedChoices', json('false')) WHERE feature_key = 'selections'")
    const refused = { success: false, error: "Your builder doesn't take suggested choices on this project. Ask a question on the selection instead." }
    expect(await addOwnerSuggestedChoice("p1", "tile", { name: "X", url: "", note: "" })).toEqual(refused)
    expect(await updateOwnerSuggestedChoice("p1", id, { name: "X", url: "", note: "" })).toEqual(refused)
    expect(await deleteOwnerSuggestedChoice("p1", id)).toEqual(refused)
    expect((await getSelectionWorkspace("p1", "owner")).ownerSuggestedChoices).toBe(false)
  })

  it("7: a Selection Phase can't go out for signature while a picked choice is pending staff pricing", async () => {
    const zellige = await suggest()
    expect(await setSelectionChoiceChosen("p1", zellige, true, "owner")).toMatchObject({ success: true })
    const brass = await saveSelectionChoice("p1", "faucet", null, { title: "Brass", price: "300", ownerPrice: "380" })
    if (!brass.success) throw new Error(brass.error)
    await setSelectionChoiceChosen("p1", brass.data.id, true)
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toEqual({
      success: false,
      error: 'Backsplash: the owner\'s suggested choice "Zellige" is still pending staff pricing. Set its owner price before sending for signature.',
    })
    expect(mocks.envelope).not.toHaveBeenCalled()
    // Staff price it: the phase can go out.
    expect(await saveSelectionChoice("p1", "tile", zellige, { title: "Zellige", price: "28.99", ownerPrice: "4000" })).toMatchObject({ success: true })
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: true })
  })
})
