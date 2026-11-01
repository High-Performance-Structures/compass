import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeAll, describe, expect, it } from "vitest"

import {
  buildDirectorySnapshot,
  collectDirectoryRows,
  directoryQueries,
} from "../../../scripts/export-bt-directory-snapshot.mjs"
import {
  createParticipantResolver,
  parseDirectory,
  parsePeopleCatalog,
} from "../../../scripts/import-buildertrend-participants.mjs"

/*
 * The read-only directory export builds exactly the snapshot the Buildertrend
 * message importer's participant matcher reads. Checked against a database
 * built from every migration.
 */

const ORG = "org-1"
const OTHER_ORG = "org-2"
const PROJECT = "proj-1"
const NOW = "2026-01-01T00:00:00.000Z"

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES
      ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}'), ('${OTHER_ORG}', 'Other', 'other', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('u-pm', 'PM@Example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('u-owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}'),
      ('u-other', 'outside@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('om-1', '${ORG}', 'u-pm', 'project_manager', '${NOW}'), ('om-2', '${ORG}', 'u-owner', 'client', '${NOW}'),
      ('om-3', '${OTHER_ORG}', 'u-other', 'client', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES ('${PROJECT}', 'P', '${ORG}', '${NOW}');
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES ('pm-1', '${PROJECT}', 'u-pm', 'staff', '${NOW}'), ('pm-2', '${PROJECT}', 'u-owner', 'owner', '${NOW}');
    INSERT INTO internal_contacts (id, organization_id, user_id, name, email, created_at, updated_at) VALUES ('ic-1', '${ORG}', 'u-pm', 'Patricia PM', 'pat@example.com', '${NOW}', '${NOW}');
    INSERT INTO vendors (id, name, organization_id, source_system, source_record_id, created_at) VALUES ('v-1', 'Tile Co', '${ORG}', 'buildertrend', '7', '${NOW}');
    INSERT INTO vendor_contacts (id, vendor_id, name, email, source_system, source_record_id, created_at, updated_at) VALUES ('vc-1', 'v-1', 'Val Vendor', 'val@tile.example', 'buildertrend', '77', '${NOW}', '${NOW}');
    INSERT INTO customers (id, name, organization_id, buildertrend_contact_id, created_at) VALUES ('c-1', 'Owens', '${ORG}', '88', '${NOW}');
    INSERT INTO customer_contacts (id, customer_id, user_id, name, email, created_at, updated_at) VALUES ('cc-1', 'c-1', 'u-owner', 'Olive Owner', 'olive.home@example.com', '${NOW}', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, customer_id, customer_contact_id, created_at, updated_at) VALUES
      ('pc-owner', '${PROJECT}', 'owner', 'Olive Owner', 'owner@example.com', 'c-1', 'cc-1', '${NOW}', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, created_at, updated_at) VALUES
      ('pc-elec', '${PROJECT}', 'subcontractor', 'Eli Electric', 'eli@sparks.example', '${NOW}', '${NOW}');
    INSERT INTO buildertrend_staging_access_candidates (id, organization_id, source_key, contact_name, buildertrend_contact_id, matched_user_id, review_status, created_at, updated_at)
      VALUES ('a-1', '${ORG}', 'k-1', 'Pat PM', '555', 'u-pm', 'approved', '${NOW}', '${NOW}');
  `)
}

describe("export-bt-directory-snapshot", () => {
  let db: DatabaseSync
  let snapshot: ReturnType<typeof buildDirectorySnapshot>
  beforeAll(async () => {
    db = migrated()
    seed(db)
    const rows = await collectDirectoryRows(ORG, (sql: string) => db.prepare(sql).all())
    snapshot = buildDirectorySnapshot(rows)
  })

  it("issues only organization-scoped, paged SELECTs", () => {
    for (const query of directoryQueries(ORG)) {
      const sql = query.sql("")
      expect(sql).toMatch(/^SELECT /)
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/)
      expect(sql).toContain(`'${ORG}'`)
      expect(sql).toMatch(/LIMIT 500$/)
      expect(sql).not.toMatch(/\bcontent\b/)
    }
  })

  it("groups a user with the contacts that are the same person", () => {
    const owner = snapshot.people.find((person: { personKey: string }) => person.personKey === "user:u-owner")
    expect(owner).toMatchObject({
      kind: "owner", userId: "u-owner", projectIds: [PROJECT], projectContactIds: { [PROJECT]: "pc-owner" },
      emails: ["olive.home@example.com", "owner@example.com"], btIds: ["customer:88"],
    })
    const pm = snapshot.people.find((person: { personKey: string }) => person.personKey === "user:u-pm")
    expect(pm).toMatchObject({ kind: "staff", emails: ["pat@example.com", "pm@example.com"], btIds: ["internal_user:555"], names: ["Pat PM", "Patricia PM"] })
    expect(snapshot.people.some((person: { userId: string | null }) => person.userId === "u-other")).toBe(false)
    expect(snapshot.people.map((person: { personKey: string }) => person.personKey).sort()).toEqual([
      "project_contact:pc-elec", "user:u-owner", "user:u-pm", "vendor_contact:vc-1",
    ])
  })

  it("feeds the importer's matcher: email, project name and catalog BT id all resolve", () => {
    const directory = parseDirectory(snapshot)
    const catalog = parsePeopleCatalog([
      JSON.stringify({ btId: 77, type: "vendor_contact", parentBtId: 7, displayName: "Val Vendor" }),
      JSON.stringify({ btId: 555, type: "internal_user", displayName: "Pat PM" }),
    ].join("\n"))
    const resolve = createParticipantResolver({ participantMap: new Map(), directory, catalog })
    const ref = (overrides: Record<string, unknown>) => ({ participantId: null, namespace: "unknown", email: null, displayName: null, role: null, kind: "to", ...overrides })
    expect(resolve(ref({ email: "OLIVE.HOME@example.com" }), PROJECT)).toEqual({ entry: expect.objectContaining({ userId: "u-owner" }), rule: "by_email" })
    expect(resolve(ref({ displayName: "Eli Electric" }), PROJECT)).toEqual({ entry: expect.objectContaining({ decision: "new_contact", contactIds: { [PROJECT]: "pc-elec" } }), rule: "by_name_project" })
    expect(resolve(ref({ displayName: "Val Vendor" }), PROJECT)).toEqual({ entry: expect.objectContaining({ kind: "vendor", identity: "person:vendor_contact:vc-1" }), rule: "by_name_catalog" })
    expect(resolve(ref({ displayName: "Patricia PM" }), PROJECT)).toEqual({ entry: expect.objectContaining({ userId: "u-pm" }), rule: "by_name_project" })
  })
})
