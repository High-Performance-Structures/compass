import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * Owner signatures for a selections round, against a database built from
 * every migration: who picked, sending the round with its change order,
 * Foxit's sent and signed events, and reopening a signed pick.
 */

const mocks = vi.hoisted(() => ({ staff: vi.fn(), audience: vi.fn(), envelope: vi.fn(), announce: vi.fn(), notify: vi.fn() }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/foxit/esign", () => ({ createFoxitPreparedEnvelope: mocks.envelope, downloadFoxitExecutedEnvelope: vi.fn() }))
vi.mock("@/lib/esign/announce", () => ({ announceEsignOutcome: mocks.announce }))
vi.mock("@/lib/notifications/events", () => ({ notifyProjectStaffOfOutsideEvent: mocks.notify }))
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "session=abc" }), headers: async () => new Headers() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/activity-log", async (original) => {
  const actual = await original<typeof import("@/lib/activity-log")>()
  return { ...actual, recordActivityEvent: vi.fn() }
})

import { getSelectionChoicesPanel, saveSelectionChoice, setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { getRoundSigning, sendRoundForSignature } from "@/app/actions/selection-round-signing"
import { findRoundSignatureByEnvelope, handleRoundSignatureEvent } from "@/lib/domain/selections/round-signing"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null
let env: CloudflareEnv

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
    INSERT INTO projects (id, name, organization_id, project_number, contract_type, created_at) VALUES ('p1', 'Job', 'org-1', 'O-1', 'fixed_price', '${NOW}');
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

async function twoPagePdf(): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create()
  pdf.addPage([612, 792])
  pdf.addPage([612, 792])
  const bytes = await pdf.save()
  return new Uint8Array(bytes).buffer
}

beforeEach(async () => {
  sqlite = migrated()
  seed(sqlite)
  const db = drizzleOverSqlite(sqlite)
  const pdf = await twoPagePdf()
  env = {
    WORKOS_REDIRECT_URI: "https://compass.example.com/callback",
    FOXIT_ESIGN_CLIENT_ID: "id",
    FOXIT_ESIGN_CLIENT_SECRET: "secret",
    BROWSER: { quickAction: async () => new Response(pdf) },
  } as unknown as CloudflareEnv
  const user = { id: "staff", email: "pm@example.com", displayName: "Pat PM", role: "project_manager", firstName: null, lastName: null }
  mocks.staff.mockResolvedValue({ db, user, organizationId: "org-1", env })
  mocks.audience.mockResolvedValue({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
  mocks.envelope.mockResolvedValue({ envelopeId: "env-1", embeddedSessionUrl: "https://foxit.example.com/send/1" })
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("round signing", () => {
  it("records who picked for the owner, with a note", async () => {
    const hex = await choice("tile", "Hex", "4185")
    expect(await setSelectionChoiceChosen("p1", hex, true, "staff", "per phone call")).toMatchObject({ success: true })
    const panel = await getSelectionChoicesPanel("p1", "tile")
    expect(panel.success && panel.data.choices[0]).toMatchObject({ chosen: true, chosenByName: "Pat PM", chosenByAudience: "staff", chosenNote: "per phone call" })
  })

  it("sends a fixed-price round with its change order, then applies the signature and reopens a changed pick", async () => {
    const hex = await choice("tile", "Hex", "4185")
    const subway = await choice("tile", "Subway", "3200")
    const brass = await choice("faucet", "Brass", "380")
    await setSelectionChoiceChosen("p1", hex, true)
    await setSelectionChoiceChosen("p1", brass, true)

    const view = await getRoundSigning("p1", "rough-in")
    if (!view.success) throw new Error(view.error)
    expect(view.data.document).toMatchObject({ allowanceCents: 370000, ownerTotalCents: 456500, deltaCents: 86500, treatment: "change_order", blocker: null })

    expect(await sendRoundForSignature("p1", "rough-in", ["stranger@example.com"])).toMatchObject({ success: false })
    const sent = await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])
    expect(sent).toEqual({ success: true, data: { embeddedSessionUrl: "https://foxit.example.com/send/1" } })
    expect(mocks.envelope.mock.calls[0]?.[0]).toMatchObject({ parties: [{ name: "Olive Owner", email: "owner@example.com", sequence: 1 }] })

    const order = sqlite.prepare("SELECT record_type, status, amount_cents, source_type FROM project_change_orders").get()
    expect(order).toEqual({ record_type: "change_order", status: "signature_pending", amount_cents: 86500, source_type: "selection_round" })
    expect(sqlite.prepare("SELECT cost_code, amount_cents FROM project_change_order_lines ORDER BY cost_code").all()).toEqual([
      { cost_code: "09 30 00", amount_cents: 98500 },
      { cost_code: "22 40 00", amount_cents: -12000 },
    ])

    const signature = await findRoundSignatureByEnvelope(drizzleOverSqlite(sqlite), "env-1")
    if (!signature) throw new Error("no signature")
    expect(signature.status).toBe("preparing")
    await handleRoundSignatureEvent({ db: drizzleOverSqlite(sqlite), env, signature, event: "folder_sent" })
    const sentRow = await findRoundSignatureByEnvelope(drizzleOverSqlite(sqlite), "env-1")
    if (!sentRow) throw new Error("no signature")
    expect(sentRow.status).toBe("sent")
    expect(await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])).toMatchObject({ success: false })

    expect(await handleRoundSignatureEvent({ db: drizzleOverSqlite(sqlite), env, signature: sentRow, event: "folder_executed" })).toBe(true)
    expect(sqlite.prepare("SELECT status FROM project_selection_round_signatures").get()).toEqual({ status: "signed" })
    expect(sqlite.prepare("SELECT id, status, owner_approved, approved_by FROM project_finish_selections ORDER BY id").all()).toEqual([
      { id: "faucet", status: "approved", owner_approved: 1, approved_by: null },
      { id: "tile", status: "approved", owner_approved: 1, approved_by: null },
    ])
    expect(sqlite.prepare("SELECT status, foxit_status FROM project_change_orders").get()).toEqual({ status: "executed", foxit_status: "completed" })
    expect(mocks.announce).toHaveBeenCalledWith(expect.objectContaining({ kind: "selections_round", outcome: "signed" }))

    // The owner can't change a signed pick; staff can, which reopens just that selection.
    expect(await setSelectionChoiceChosen("p1", subway, true, "owner")).toMatchObject({ success: false })
    expect(await setSelectionChoiceChosen("p1", subway, true)).toMatchObject({ success: true })
    expect(sqlite.prepare("SELECT status, owner_approved FROM project_finish_selections WHERE id = 'tile'").get()).toEqual({ status: "owner_review", owner_approved: 0 })
    const again = await getRoundSigning("p1", "rough-in")
    if (!again.success) throw new Error(again.error)
    expect(again.data.document.toSign.map((line) => line.selectionId)).toEqual(["tile"])
    expect(again.data.document.lines.find((line) => line.selectionId === "faucet")?.signedEarlier).toBe(true)
    expect(again.data.signatures[0]).toMatchObject({ status: "signed", itemCount: 2, signedDocumentHref: "/api/integrations/foxit/envelopes/env-1/document" })
  })

  it("can't send until every selection in the round has a priced pick", async () => {
    const hex = await choice("tile", "Hex", "4185")
    await setSelectionChoiceChosen("p1", hex, true)
    const result = await sendRoundForSignature("p1", "rough-in", ["owner@example.com"])
    expect(result).toEqual({ success: false, error: "Faucet doesn't have the owner's pick yet." })
    expect(mocks.envelope).not.toHaveBeenCalled()
  })
})
