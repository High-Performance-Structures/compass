import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { customerContacts, customers, internalContacts, vendorContacts, vendors } from "@/db/schema"
import { projectContactInvitationDirectorySelection } from "@/lib/project-contact-invitation-select"

describe("project invitation directory joins", () => {
  it("retains a client person whose Compass account link is blank", () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.exec(`
        CREATE TABLE customers (id TEXT PRIMARY KEY);
        CREATE TABLE customer_contacts (
          id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT,
          email TEXT, phone TEXT, active INTEGER NOT NULL
        );
        INSERT INTO customers (id) VALUES ('client-1');
        INSERT INTO customer_contacts (id, customer_id, user_id, email, phone, active)
          VALUES ('person-1', 'client-1', NULL, 'person@example.test', NULL, 1);
      `)
      const db = drizzle(sqlite)
      const linked = db
        .select({ person: projectContactInvitationDirectorySelection.customerContact })
        .from(customers)
        .leftJoin(customerContacts, eq(customerContacts.customerId, customers.id))
        .where(eq(customers.id, "client-1"))
        .get()

      expect(linked?.person).toEqual({
        id: "person-1",
        userId: null,
        email: "person@example.test",
        phone: null,
      })
    } finally {
      sqlite.close()
    }
  })

  it("keeps a vendor person with no account or contact channels, but not an absent join", () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.exec(`
        CREATE TABLE vendors (id TEXT PRIMARY KEY);
        CREATE TABLE vendor_contacts (
          id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, user_id TEXT,
          email TEXT, phone TEXT
        );
        INSERT INTO vendors (id) VALUES ('vendor-1'), ('vendor-2');
        INSERT INTO vendor_contacts (id, vendor_id, user_id, email, phone)
          VALUES ('person-2', 'vendor-1', NULL, NULL, NULL);
      `)
      const db = drizzle(sqlite)
      const rows = db
        .select({ vendor: vendors.id, person: projectContactInvitationDirectorySelection.vendorContact })
        .from(vendors)
        .leftJoin(vendorContacts, eq(vendorContacts.vendorId, vendors.id))
        .all()

      expect(rows).toEqual([
        { vendor: "vendor-1", person: { id: "person-2", userId: null, email: null, phone: null } },
        { vendor: "vendor-2", person: null },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("retains an internal person before their Compass account is linked", () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.exec(`
        CREATE TABLE internal_contacts (
          id TEXT PRIMARY KEY, user_id TEXT, email TEXT, phone TEXT
        );
        INSERT INTO internal_contacts (id, user_id, email, phone)
          VALUES ('person-3', NULL, 'staff@example.test', NULL);
      `)
      const db = drizzle(sqlite)
      const linked = db
        .select({ person: projectContactInvitationDirectorySelection.internalPerson })
        .from(internalContacts)
        .get()

      expect(linked?.person).toEqual({
        id: "person-3",
        userId: null,
        email: "staff@example.test",
        phone: null,
      })
    } finally {
      sqlite.close()
    }
  })
})
