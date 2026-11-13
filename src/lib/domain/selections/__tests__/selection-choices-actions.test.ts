import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyMigrations } from "@/test/migrated-database"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

/*
 * The selection choice actions against a database built from every
 * migration: choices, ordering, the single chosen flag, follow-up selections,
 * supplier links, photo links, and owner/staff comment visibility.
 */

const mocks = vi.hoisted(() => ({ staff: vi.fn(), audience: vi.fn(), preview: vi.fn() }))
vi.mock("@/lib/domain/selections/access", () => ({ staffSelectionContext: mocks.staff, selectionAccess: mocks.audience }))
vi.mock("@/lib/selections/link-preview", async (original) => {
  const actual = await original<typeof import("@/lib/selections/link-preview")>()
  return { ...actual, fetchLinkPreview: mocks.preview }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  addSelectionComment,
  addSelectionLink,
  attachSelectionPhotos,
  deleteSelectionChoice,
  deleteSelectionComment,
  deleteSelectionLink,
  detachSelectionPhoto,
  getAttachableSelectionPhotos,
  getSelectionChoicesPanel,
  reorderSelectionChoices,
  saveSelectionChoice,
  setChoiceDependentSelections,
  setSelectionChoiceChosen,
} from "@/app/actions/selection-choices"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
let sqlite: Sqlite

// Every migration is replayed once per file; each test gets a fresh copy.
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
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES
      ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}'),
      ('org-2', 'Other', 'other', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}'), ('p2', 'Other job', 'org-1', '${NOW}');
    INSERT INTO vendors (id, name, organization_id, created_at, updated_at) VALUES
      ('v1', 'Tile Supply', 'org-1', '${NOW}', '${NOW}'),
      ('v-other', 'Elsewhere', 'org-2', '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, created_at, updated_at) VALUES
      ('vanity', 'p1', 'Bath', 'Vanity', '${NOW}', '${NOW}'),
      ('hardware', 'p1', 'Bath', 'Hardware', '${NOW}', '${NOW}'),
      ('elsewhere', 'p2', 'Bath', 'Other', '${NOW}', '${NOW}');
    INSERT INTO daily_log_photos (id, project_id, file_name, owner_visible, created_at, updated_at) VALUES
      ('ph1', 'p1', 'oak.jpg', 1, '${NOW}', '${NOW}'),
      ('ph2', 'p1', 'private.jpg', 0, '${NOW}', '${NOW}'),
      ('ph-other', 'p2', 'x.jpg', 1, '${NOW}', '${NOW}');
  `)
}

function publishToOwner(selectionId: string): void {
  sqlite.prepare(`INSERT INTO project_selection_decisions (selection_id, project_id, revision, published, specification_json, last_mutation_id, updated_at)
    VALUES (?, 'p1', 1, 1, '{}', 'm', ?)`).run(selectionId, NOW)
}

async function choice(title: string, extra: Partial<{ price: string; vendorId: string }> = {}): Promise<string> {
  const result = await saveSelectionChoice("p1", "vanity", null, { title, ...extra })
  if (!result.success) throw new Error(result.error)
  return result.data.id
}

async function staffPanel() {
  const result = await getSelectionChoicesPanel("p1", "vanity")
  if (!result.success) throw new Error(result.error)
  return result.data
}

beforeEach(() => {
  sqlite = migrated()
  seed(sqlite)
  const db = drizzleOverSqlite(sqlite)
  mocks.staff.mockResolvedValue({ db, user: { id: "staff" }, organizationId: "org-1" })
  mocks.audience.mockResolvedValue({ db, user: { id: "owner" }, staff: false, actorName: "Olive Owner" })
  mocks.preview.mockResolvedValue({ title: "Oak vanity 36", imageUrl: "https://shop.example.com/oak.jpg", siteName: "Shop", priceCents: 129900 })
})
afterEach(() => {
  sqlite.close()
  vi.clearAllMocks()
})

describe("selection choices", () => {
  it("adds, edits, orders, chooses and deletes choices", async () => {
    const oak = await choice("Oak 36", { price: "1,299", vendorId: "v1" })
    const walnut = await choice("Walnut 48")
    expect(await saveSelectionChoice("p1", "vanity", walnut, { title: "Walnut 48", leadTimeDays: "21", supplierName: "Local mill" })).toMatchObject({ success: true })
    expect(await saveSelectionChoice("p1", "vanity", null, { title: "X", vendorId: "v-other" })).toEqual({ success: false, error: "Supplier not found." })

    expect(await reorderSelectionChoices("p1", "vanity", [walnut, oak])).toMatchObject({ success: true })
    expect(await reorderSelectionChoices("p1", "vanity", [walnut])).toMatchObject({ success: false })

    expect(await setSelectionChoiceChosen("p1", oak, true)).toMatchObject({ success: true })
    expect(await setSelectionChoiceChosen("p1", walnut, true)).toMatchObject({ success: true })

    const panel = await staffPanel()
    expect(panel.choices.map((row) => [row.title, row.chosen, row.priceCents, row.vendorName, row.supplierName, row.leadTimeDays])).toEqual([
      ["Walnut 48", true, null, null, "Local mill", 21],
      ["Oak 36", false, 129900, "Tile Supply", null, null],
    ])

    expect(await deleteSelectionChoice("p1", oak)).toMatchObject({ success: true })
    expect((await staffPanel()).choices).toHaveLength(1)
  })

  it("saves follow-up selections on the same project only", async () => {
    const oak = await choice("Oak 36")
    expect(await setChoiceDependentSelections("p1", oak, ["hardware", "vanity"])).toMatchObject({ success: true })
    expect((await staffPanel()).choices[0]?.dependentSelectionIds).toEqual(["hardware"])
    expect(await setChoiceDependentSelections("p1", oak, ["elsewhere"])).toMatchObject({ success: false })
  })

  it("saves supplier links with the page preview, and plain links when the page cannot be read", async () => {
    const oak = await choice("Oak 36")
    expect(await addSelectionLink("p1", "vanity", oak, "shop.example.com/oak")).toMatchObject({ success: true })
    mocks.preview.mockResolvedValueOnce({ title: null, imageUrl: null, siteName: null, priceCents: null })
    expect(await addSelectionLink("p1", "vanity", null, "https://inspo.example.com/board")).toMatchObject({ success: true })
    expect(await addSelectionLink("p1", "vanity", null, "javascript:alert(1)")).toMatchObject({ success: false })

    const panel = await staffPanel()
    expect(panel.choices[0]?.links).toEqual([
      expect.objectContaining({ url: "https://shop.example.com/oak", title: "Oak vanity 36", priceCents: 129900, addedByAudience: "staff" }),
    ])
    expect(panel.selectionLinks).toEqual([expect.objectContaining({ url: "https://inspo.example.com/board", title: null })])
    const linkId = panel.selectionLinks[0]?.id ?? ""
    expect(await deleteSelectionLink("p1", "vanity", linkId)).toMatchObject({ success: true })
  })

  it("links project photos to a selection or choice and hides private photos from owners", async () => {
    const oak = await choice("Oak 36")
    const attachable = await getAttachableSelectionPhotos("p1")
    expect(attachable.success && attachable.data.map((photo) => photo.id).sort()).toEqual(["ph1", "ph2"])
    expect(await attachSelectionPhotos("p1", "vanity", oak, ["ph1"])).toMatchObject({ success: true })
    expect(await attachSelectionPhotos("p1", "vanity", null, ["ph2"])).toMatchObject({ success: true })
    expect(await attachSelectionPhotos("p1", "vanity", null, ["ph-other"])).toMatchObject({ success: false })

    const panel = await staffPanel()
    expect(panel.choices[0]?.photos.map((photo) => photo.fileName)).toEqual(["oak.jpg"])
    expect(panel.selectionPhotos.map((photo) => photo.fileName)).toEqual(["private.jpg"])

    publishToOwner("vanity")
    const owner = await getSelectionChoicesPanel("p1", "vanity", "owner")
    expect(owner.success && owner.data.selectionPhotos).toEqual([])

    const linkId = panel.selectionPhotos[0]?.linkId ?? ""
    expect(await detachSelectionPhoto("p1", linkId)).toMatchObject({ success: true })
    expect((await staffPanel()).selectionPhotos).toEqual([])
  })
})

describe("owner view, links and comments", () => {
  it("keeps unpublished selections from owners", async () => {
    expect(await getSelectionChoicesPanel("p1", "vanity", "owner")).toEqual({ success: false, error: "Selection not found" })
    expect(await addSelectionComment("p1", "vanity", "Hi", "owner", "owner")).toEqual({ success: false, error: "Selection not found" })
  })

  it("shows owners only owner-visible comments and no supplier or supplier price", async () => {
    await choice("Oak 36", { price: "1,299", vendorId: "v1" })
    publishToOwner("vanity")
    expect(await addSelectionComment("p1", "vanity", "Margin is thin here", "staff")).toMatchObject({ success: true })
    expect(await addSelectionComment("p1", "vanity", "Samples arrive Friday", "owner")).toMatchObject({ success: true })
    expect(await addSelectionComment("p1", "vanity", "Can we see walnut?", "staff", "owner")).toMatchObject({ success: true })
    expect(await addSelectionLink("p1", "vanity", null, "https://shop.example.com/walnut", "owner")).toMatchObject({ success: true })

    const owner = await getSelectionChoicesPanel("p1", "vanity", "owner")
    if (!owner.success) throw new Error(owner.error)
    expect(owner.data.comments.map((comment) => [comment.body, comment.visibility, comment.canDelete])).toEqual([
      ["Samples arrive Friday", "owner", false],
      ["Can we see walnut?", "owner", true],
    ])
    expect(owner.data.choices[0]).toMatchObject({ title: "Oak 36", priceCents: null, vendorName: null })
    expect(owner.data.selectionLinks[0]).toMatchObject({ addedByAudience: "owner" })

    const staffComments = (await staffPanel()).comments
    expect(staffComments).toHaveLength(3)
    const staffOnly = staffComments.find((comment) => comment.visibility === "staff")?.id ?? ""
    expect(await deleteSelectionComment("p1", "vanity", staffOnly, "owner")).toMatchObject({ success: false })
    expect(await deleteSelectionComment("p1", "vanity", staffOnly)).toMatchObject({ success: true })
  })
})
