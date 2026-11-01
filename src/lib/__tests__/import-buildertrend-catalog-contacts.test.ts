import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  newCatalogContacts,
  parseCapture,
  parsePrecheck,
  planImport,
} from "../../../scripts/import-buildertrend-messages.mjs"
import {
  DIRECTORY_SCHEMA,
  createParticipantResolver,
  parseDirectory,
  parsePeopleCatalog,
} from "../../../scripts/import-buildertrend-participants.mjs"

/*
 * Owner decision 1: a Buildertrend participant who is not in the Compass
 * directory is added as an uninvited directory contact. A unique catalog
 * match with no Compass record becomes a vendor contact (under the vendor
 * matched by the catalog parent's BT id, created when missing) or a customer
 * contact under the project's single client. Staff must be real users.
 */

const ORG = "org-1"
const PROJECT = "proj-1"
const NO_CLIENT_PROJECT = "proj-none"
const TWO_CLIENT_PROJECT = "proj-two"
const NOW = "2026-01-01T00:00:00.000Z"

const directory = parseDirectory({
  schema: DIRECTORY_SCHEMA,
  people: [{ personKey: "user:u-pm", kind: "staff", userId: "u-pm", displayName: "Pat PM", emails: ["pm@example.com"], projectIds: [PROJECT] }],
  vendors: [{ vendorId: "v-tile", btId: "7" }],
  projects: [
    { projectId: PROJECT, clientCustomerIds: ["c-owens"] },
    { projectId: NO_CLIENT_PROJECT, clientCustomerIds: [] },
    { projectId: TWO_CLIENT_PROJECT, clientCustomerIds: ["c-owens", "c-other"] },
  ],
})

const catalog = parsePeopleCatalog([
  { btId: 7, type: "vendor_company", displayName: "Tile Co" },
  { btId: 71, type: "vendor_contact", parentBtId: 7, displayName: "Tina Tile", email: "tina@tile.example" },
  { btId: 8, type: "vendor_company", displayName: "Sparks LLC" },
  { btId: 81, type: "vendor_contact", parentBtId: 8, displayName: "Eli Electric" },
  { btId: 91, type: "vendor_contact", parentBtId: 9, displayName: "Orphan Person" },
  { btId: 300, type: "customer", displayName: "Olive Owner" },
  { btId: 400, type: "internal_user", displayName: "New Hire" },
].map((row) => JSON.stringify(row)).join("\n"))

const resolve = createParticipantResolver({ participantMap: new Map(), directory, catalog, organizationId: ORG })

function ref(overrides: Record<string, unknown>) {
  return { participantId: null, namespace: "unknown", email: null, displayName: null, role: null, kind: "to", ...overrides }
}

describe("new directory contacts from the Buildertrend catalog", () => {
  it("adds a vendor contact under the vendor matched by the parent's BT id", () => {
    const result = resolve(ref({ displayName: "Tina Tile" }), PROJECT)
    expect(result.rule).toBe("new_contact_from_catalog")
    expect(result.entry).toMatchObject({ kind: "vendor", identity: "catalog:vendor_contact:71", links: { vendorId: "v-tile" } })
    expect(result.entry.createDirectory.vendor).toBeNull()
  })

  it("finds the catalog row by the email shown before the name", () => {
    const result = resolve(ref({ email: "TINA@tile.example", displayName: "T. Tile" }), PROJECT)
    expect(result).toMatchObject({ rule: "new_contact_from_catalog", entry: { identity: "catalog:vendor_contact:71" } })
  })

  it("creates the vendor company too when the parent is not in Compass", () => {
    const result = resolve(ref({ displayName: "Eli Electric" }), PROJECT)
    expect(result.entry.createDirectory.vendor).toMatchObject({ name: "Sparks LLC", btId: "8" })
    expect(result.entry.links.vendorId).toBe(result.entry.createDirectory.vendor.id)
  })

  it("records a company participant as the company's own contact", () => {
    const result = resolve(ref({ displayName: "Sparks LLC" }), PROJECT)
    expect(result.entry).toMatchObject({ kind: "vendor", identity: "catalog:vendor_company:8" })
    expect(result.entry.createDirectory.vendorContact).toMatchObject({ name: "Sparks LLC", btId: null })
  })

  it("sends a vendor contact whose company is unknown everywhere to review", () => {
    expect(resolve(ref({ displayName: "Orphan Person" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
  })

  it("adds a customer contact under the project's single client, else review", () => {
    expect(resolve(ref({ displayName: "Olive Owner" }), PROJECT)).toMatchObject({
      rule: "new_contact_from_catalog", entry: { kind: "owner", links: { customerId: "c-owens" } },
    })
    expect(resolve(ref({ displayName: "Olive Owner" }), NO_CLIENT_PROJECT)).toEqual({ reason: "participant_unmatched" })
    expect(resolve(ref({ displayName: "Olive Owner" }), TWO_CLIENT_PROJECT)).toEqual({ reason: "participant_ambiguous" })
  })

  it("never invents staff, and still reviews people missing from the catalog", () => {
    expect(resolve(ref({ displayName: "New Hire" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
    expect(resolve(ref({ displayName: "Nobody Known" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
  })
})

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

describe("importing catalog contacts", () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = migrated()
    db.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('u-pm', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}');
      INSERT INTO customers (id, name, organization_id, created_at) VALUES ('c-owens', 'Owens', '${ORG}', '${NOW}');
      INSERT INTO vendors (id, name, organization_id, source_system, source_record_id, created_at) VALUES ('v-tile', 'Tile Co', '${ORG}', 'buildertrend', '7', '${NOW}');
      INSERT INTO projects (id, name, organization_id, client_customer_id, created_at) VALUES ('${PROJECT}', 'P', '${ORG}', 'c-owens', '${NOW}');
    `)
  })

  function run() {
    const message = (id: string, thread: string, recipient: string) => JSON.stringify({
      schema: CAPTURE_SCHEMA, type: "message", btJobId: "101", btThreadId: thread, btMessageId: id, subject: "Tile", body: "Hi",
      sentAtDisplay: "Oct 3, 2025 4:12 PM", sender: { namespace: "builder", email: "pm@example.com", displayName: "Pat PM" },
      recipients: [{ namespace: "sub", displayName: recipient, kind: "to" }], attachments: [],
    })
    const thread = (id: string) => JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: "101", btThreadId: id, messageCount: 1 })
    const plan = planImport({
      capture: parseCapture([message("1", "9001", "Tina Tile"), thread("9001"), message("2", "9002", "Eli Electric"), thread("9002"), message("3", "9003", "Eli Electric"), thread("9003")].join("\n")),
      resolveParticipant: resolve,
      precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [] }),
      projects: { "101": PROJECT },
      timeZone: "America/Denver",
      organizationId: ORG,
    })
    const built = buildBatches(plan, { actorUserId: "u-pm", now: NOW, driveFiles: new Map(), batchSize: 40 })
    for (const batch of built.batches) db.exec(batch.statements.join("\n"))
    return plan
  }

  function count(query: string): number {
    return Number(db.prepare(query).all()[0]?.n ?? 0)
  }

  it("writes the vendor, vendor contacts and project contacts once, and lists them for review", () => {
    const plan = run()
    expect(plan.reviews).toEqual([])
    expect(plan.matches.new_contact_from_catalog).toBe(3)
    expect(newCatalogContacts(plan).map((item: { identity: string }) => item.identity).sort()).toEqual(["catalog:vendor_contact:71", "catalog:vendor_contact:81"])
    expect(db.prepare(`SELECT name, source_system, source_record_id FROM vendors WHERE source_record_id = '8'`).all()).toEqual([{ name: "Sparks LLC", source_system: "buildertrend", source_record_id: "8" }])
    expect(count(`SELECT COUNT(*) AS n FROM vendor_contacts WHERE source_record_id IN ('71', '81')`)).toBe(2)
    expect(count(`SELECT COUNT(*) AS n FROM project_contacts WHERE vendor_contact_id IS NOT NULL`)).toBe(2)
    expect(count(`SELECT COUNT(*) AS n FROM project_access_invitations`)).toBe(0)
  })

  it("is idempotent: a second run adds no vendor, contact or project contact", () => {
    run()
    const tables = ["vendors", "vendor_contacts", "customer_contacts", "project_contacts"]
    const before = tables.map((table) => count(`SELECT COUNT(*) AS n FROM ${table}`))
    run()
    expect(tables.map((table) => count(`SELECT COUNT(*) AS n FROM ${table}`))).toEqual(before)
  })
})
