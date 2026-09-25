import { readFileSync } from "node:fs"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

function fixture(): InstanceType<typeof Database> {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE customers (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
    CREATE TABLE vendors (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
    CREATE TABLE customer_contacts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE vendor_contacts (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO organizations VALUES ('org-a'), ('org-b');
    INSERT INTO users VALUES ('client-a'), ('vendor-a'), ('client-b'), ('staff-a');
    INSERT INTO organization_members VALUES
      ('org-a', 'client-a', 'client'), ('org-a', 'vendor-a', 'supplier'),
      ('org-b', 'client-b', 'client'), ('org-a', 'staff-a', 'office');
    INSERT INTO customers VALUES ('customer-a', 'org-a');
    INSERT INTO vendors VALUES ('vendor-a', 'org-a');
    INSERT INTO customer_contacts VALUES ('person-c', 'customer-a', '2026-01-01');
    INSERT INTO vendor_contacts VALUES ('person-v', 'vendor-a', '2026-01-01');
  `)
  const migration = readFileSync(new URL("../../../drizzle/0169_contact_person_account_links.sql", import.meta.url), "utf8")
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement)
  }
  return db
}

describe("contact-person account links", () => {
  it("permits deliberate in-organization links with a matching external role", () => {
    const db = fixture()
    try {
      db.prepare("UPDATE customer_contacts SET user_id = 'client-a' WHERE id = 'person-c'").run()
      db.prepare("UPDATE vendor_contacts SET user_id = 'vendor-a' WHERE id = 'person-v'").run()
      expect(db.prepare("SELECT user_id FROM customer_contacts WHERE id = 'person-c'").get()).toEqual({ user_id: "client-a" })
      expect(db.prepare("SELECT user_id FROM vendor_contacts WHERE id = 'person-v'").get()).toEqual({ user_id: "vendor-a" })
    } finally { db.close() }
  })

  it("rejects another organization and a staff account", () => {
    const db = fixture()
    try {
      expect(() => db.prepare("UPDATE customer_contacts SET user_id = 'client-b' WHERE id = 'person-c'").run()).toThrow()
      expect(() => db.prepare("UPDATE customer_contacts SET user_id = 'staff-a' WHERE id = 'person-c'").run()).toThrow()
      expect(() => db.prepare("UPDATE vendor_contacts SET user_id = 'client-a' WHERE id = 'person-v'").run()).toThrow()
    } finally { db.close() }
  })

  it("prevents rewriting or deleting link history", () => {
    const db = fixture()
    try {
      db.prepare(`INSERT INTO contact_account_link_events VALUES
        ('event-1', 'org-a', 'client_person', 'person-c', NULL, 'client-a', 'staff-a', '2026-01-01')`).run()
      expect(() => db.prepare("UPDATE contact_account_link_events SET next_user_id = NULL WHERE id = 'event-1'").run()).toThrow()
      expect(() => db.prepare("DELETE FROM contact_account_link_events WHERE id = 'event-1'").run()).toThrow()
    } finally { db.close() }
  })

  it("records an event only after a successful compare-and-set link", () => {
    const db = fixture()
    try {
      const update = db.prepare("UPDATE customer_contacts SET user_id = ? WHERE id = 'person-c' AND user_id IS ?")
      const audit = db.prepare(`INSERT INTO contact_account_link_events SELECT
        ?, 'org-a', 'client_person', 'person-c', NULL, 'client-a', 'staff-a', '2026-01-01'
        WHERE changes() = 1`)
      expect(update.run("client-a", null).changes).toBe(1)
      expect(audit.run("event-1").changes).toBe(1)
      expect(update.run("client-a", null).changes).toBe(0)
      expect(audit.run("event-2").changes).toBe(0)
      expect(db.prepare("SELECT count(*) AS count FROM contact_account_link_events").get()).toEqual({ count: 1 })
    } finally { db.close() }
  })
})
