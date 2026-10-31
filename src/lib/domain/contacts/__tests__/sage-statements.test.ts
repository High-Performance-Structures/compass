import { describe, expect, it } from "vitest"

import { expectedShape, recordingD1, statementShape } from "@/lib/domain/__tests__/recording-d1"
import {
  contactAccountLinkStatements,
  contactMergeStatements,
  insertSageCreatedPersonStatement,
  sageClientWriteResultCustomerStatement,
  sageIdentityLinkStatement,
  sageSnapshotDirectoryUpdateStatement,
  upsertInternalContactPrivateAddressStatement,
} from "@/lib/domain/contacts/store"

/*
 * The raw directory writes moved here from the Sage bridge, the duplicate
 * merge and the account-link actions. Each builds the same SQL (whitespace
 * aside) with the same binds as the statement it replaced, written out below.
 */
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"
const uuid = /^[0-9a-f-]{36}$/

describe("contacts store: Sage bridge writes", () => {
  it("writes the Sage client identity returned for a customer", () => {
    const statement = sageClientWriteResultCustomerStatement(d1, {
      customerId: "c1", sageClientId: "sid", sageClientNumber: "101", sageClientStatusId: 2, now,
    })
    expect(statementShape(statement)).toEqual(expectedShape(
      `UPDATE customers
         SET sage_client_id = ?, sage_client_number = ?,
             sage_client_status_id = ?, updated_at = ?
         WHERE id = ?`,
      ["sid", "101", 2, now, "c1"],
    ))
  })

  it("applies a Sage snapshot to each directory kind with the same scope as before", () => {
    const a = "`sage_x` = ?, `city` = ?, updated_at = ?"
    const binds = ["b1", "b2"]
    const previous = {
      client_company: `UPDATE customers SET ${a}
       WHERE id = ? AND organization_id = ? AND sage_client_id = ?`,
      vendor_company: `UPDATE vendors SET ${a},
         sync_status = 'synced', last_synced_at = ?
       WHERE id = ? AND organization_id = ? AND sage_vendor_id = ?`,
      client_person: `UPDATE customer_contacts SET ${a},
         sync_status = 'synced', last_synced_at = ?
       WHERE id = ? AND sage_contact_id = ?
         AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)`,
      vendor_person: `UPDATE vendor_contacts SET ${a}
       WHERE id = ? AND sage_contact_id = ?
         AND vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)`,
      employee: `UPDATE internal_contacts SET ${a},
         sync_status = 'synced', last_synced_at = ?
       WHERE id = ? AND organization_id = ? AND sage_employee_id = ?`,
    } as const
    for (const kind of ["client_company", "vendor_company", "client_person", "vendor_person", "employee"] as const) {
      expect(statementShape(sageSnapshotDirectoryUpdateStatement(d1, kind, a, binds)))
        .toEqual(expectedShape(previous[kind], binds))
    }
  })

  it("upserts an employee's private address columns as before", () => {
    const statement = upsertInternalContactPrivateAddressStatement(d1, {
      internalContactId: "i1", columns: ["address_line_1", "city"], values: ["1 Main", null], now,
    })
    expect(statementShape(statement)).toEqual(expectedShape(
      `INSERT INTO internal_contact_private_addresses
         (internal_contact_id, \`address_line_1\`, \`city\`, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(internal_contact_id) DO UPDATE SET
           \`address_line_1\` = excluded.\`address_line_1\`, \`city\` = excluded.\`city\`,
           updated_at = excluded.updated_at`,
      ["i1", "1 Main", null, now],
    ))
  })

  it("inserts the person Sage added with the same fences per kind", () => {
    const binds = ["b"]
    expect(statementShape(insertSageCreatedPersonStatement(d1, "client_person", binds))).toEqual(expectedShape(
      `INSERT INTO customer_contacts
         (id, customer_id, name, title, email, phone, phone_extension, cell_phone,
          sage_contact_id, sage_line_number, is_primary, active, source_system,
          sync_status, last_synced_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = ? AND active = 1) THEN 0 ELSE 1 END,
           1, 'sage', 'synced', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND organization_id = ? AND sage_client_id = ?)
           AND EXISTS (SELECT 1 FROM sage_contact_create_proposals
             WHERE id = ? AND status = 'running' AND claim_token = ?)`,
      binds,
    ))
    expect(statementShape(insertSageCreatedPersonStatement(d1, "vendor_person", binds))).toEqual(expectedShape(
      `INSERT INTO vendor_contacts
         (id, vendor_id, name, title, email, phone, phone_extension, cell_phone,
          sage_contact_id, sage_line_number, is_primary, active, source_system,
          created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN EXISTS (SELECT 1 FROM vendor_contacts WHERE vendor_id = ? AND active = 1) THEN 0 ELSE 1 END,
           1, 'sage', ?, ?
         WHERE EXISTS (SELECT 1 FROM vendors WHERE id = ? AND organization_id = ?
           AND sage_vendor_id = ? AND directory_status = 'active')
           AND EXISTS (SELECT 1 FROM sage_contact_create_proposals
             WHERE id = ? AND status = 'running' AND claim_token = ?)`,
      binds,
    ))
  })

  it("links a reviewed Sage identity with the same guard per kind", () => {
    const guard = `EXISTS (SELECT 1 FROM sage_contact_read_requests
      WHERE id = ? AND organization_id = ? AND status = 'linking' AND claim_token = ?)`
    const binds = ["b"]
    const previous = {
      client_company: `UPDATE customers SET sage_client_id = ?, sage_client_number = ?
         WHERE id = ? AND organization_id = ? AND sage_client_id IS NULL
           AND (sage_client_number IS NULL OR sage_client_number = ?) AND ${guard}`,
      vendor_company: `UPDATE vendors SET sage_vendor_id = ?, sage_vendor_number = ?
           WHERE id = ? AND organization_id = ? AND sage_vendor_id IS NULL
             AND (sage_vendor_number IS NULL OR sage_vendor_number = ?) AND ${guard}`,
      employee: `UPDATE internal_contacts SET sage_employee_id = ?, sage_employee_number = ?
             WHERE id = ? AND organization_id = ? AND sage_employee_id IS NULL
               AND (sage_employee_number IS NULL OR sage_employee_number = ?) AND ${guard}`,
      client_person: `UPDATE customer_contacts SET sage_contact_id = ?, sage_line_number = ?
               WHERE id = ? AND sage_contact_id IS NULL
                 AND (sage_line_number IS NULL OR sage_line_number = ?)
                 AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)
                 AND ${guard}`,
      vendor_person: `UPDATE vendor_contacts SET sage_contact_id = ?, sage_line_number = ?
               WHERE id = ? AND sage_contact_id IS NULL
                 AND (sage_line_number IS NULL OR sage_line_number = ?)
                 AND vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)
                 AND ${guard}`,
    } as const
    for (const kind of ["client_company", "vendor_company", "employee", "client_person", "vendor_person"] as const) {
      expect(statementShape(sageIdentityLinkStatement(d1, kind, guard, binds))).toEqual(expectedShape(previous[kind], binds))
    }
  })
})

describe("contacts store: duplicate merges", () => {
  const base = {
    organizationId: "org-1", sourceId: "s", destinationId: "d", sourceSnapshot: "{s}", destinationSnapshot: "{d}",
    peopleCount: 2, projectContactCount: 3, userId: "u1", now,
  }
  const event = `INSERT INTO contact_merge_events
        (id, organization_id, kind, source_id, destination_id, source_snapshot_json,
         destination_snapshot_json, moved_people_count, moved_project_contacts_count,
         merged_by_user_id, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  const moveBinds = ["d", "s", "d", "s", "d", now, "s", "s"]

  function withoutEventId(kind: string, statements: readonly unknown[]): unknown[] {
    const [first, ...rest] = statements.map(statementShape)
    if (!first) throw new Error("missing merge event")
    expect(String(first.binds[0])).toMatch(uuid)
    expect({ sql: first.sql, binds: first.binds.slice(1) }).toEqual(expectedShape(event,
      ["org-1", kind, "s", "d", "{s}", "{d}", 2, 3, "u1", now]))
    return rest
  }

  it("merges companies children first, as before", () => {
    expect(withoutEventId("customer_company", contactMergeStatements(d1, { ...base, kind: "customer_company" }))).toEqual([
      expectedShape("UPDATE customer_contacts SET customer_id = ?, updated_at = ? WHERE customer_id = ?", ["d", now, "s"]),
      expectedShape("UPDATE project_contacts SET customer_id = ?, source_entity_id = CASE WHEN source_entity_type = 'customer' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'customer' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE customer_id = ? OR (source_entity_type = 'customer' AND source_entity_id = ?)", moveBinds),
      expectedShape("UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_customer_id IS NULL", ["d", now, "s", "org-1"]),
    ])
    expect(withoutEventId("vendor_company", contactMergeStatements(d1, { ...base, kind: "vendor_company" }))).toEqual([
      expectedShape("UPDATE vendor_contacts SET vendor_id = ?, updated_at = ? WHERE vendor_id = ?", ["d", now, "s"]),
      expectedShape("UPDATE project_contacts SET vendor_id = ?, source_entity_id = CASE WHEN source_entity_type = 'vendor' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'vendor' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE vendor_id = ? OR (source_entity_type = 'vendor' AND source_entity_id = ?)", moveBinds),
      expectedShape("UPDATE vendors SET merged_into_vendor_id = ?, directory_status = 'merged', updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_vendor_id IS NULL", ["d", now, "s", "org-1"]),
    ])
  })

  it("merges people as before", () => {
    expect(withoutEventId("customer_person", contactMergeStatements(d1, { ...base, kind: "customer_person" }))).toEqual([
      expectedShape("UPDATE project_contacts SET customer_contact_id = ?, source_entity_id = CASE WHEN source_entity_type = 'customer_contact' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'customer_contact' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE customer_contact_id = ? OR (source_entity_type = 'customer_contact' AND source_entity_id = ?)", moveBinds),
      expectedShape("UPDATE customer_contacts SET is_primary = 1, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM customer_contacts WHERE id = ? AND is_primary = 1)", [now, "d", "s"]),
      expectedShape("UPDATE customer_contacts SET active = 0, merged_into_person_id = ?, is_primary = 0, updated_at = ? WHERE id = ? AND active = 1 AND merged_into_person_id IS NULL", ["d", now, "s"]),
    ])
    expect(withoutEventId("vendor_person", contactMergeStatements(d1, { ...base, kind: "vendor_person" }))).toEqual([
      expectedShape("UPDATE project_contacts SET vendor_contact_id = ?, source_entity_id = CASE WHEN source_entity_type = 'vendor_contact' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'vendor_contact' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE vendor_contact_id = ? OR (source_entity_type = 'vendor_contact' AND source_entity_id = ?)", moveBinds),
      expectedShape("UPDATE vendor_contacts SET is_primary = 1, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM vendor_contacts WHERE id = ? AND is_primary = 1)", [now, "d", "s"]),
      expectedShape("UPDATE vendor_contacts SET active = 0, merged_into_person_id = ?, is_primary = 0, updated_at = ? WHERE id = ? AND active = 1 AND merged_into_person_id IS NULL", ["d", now, "s"]),
    ])
  })
})

describe("contacts store: account links", () => {
  it("compare-and-sets the account, then audits only a changed row", () => {
    for (const kind of ["client_person", "vendor_person"] as const) {
      const [update, audit] = contactAccountLinkStatements(d1, {
        kind, organizationId: "org-1", personId: "p1", previousUserId: null, nextUserId: "u2", changedByUserId: "u1", now,
      }).map(statementShape)
      expect(update).toEqual(expectedShape(kind === "client_person"
        ? `UPDATE customer_contacts SET user_id = ?, updated_at = ?
         WHERE id = ? AND user_id IS ? AND customer_id IN
           (SELECT id FROM customers WHERE organization_id = ?)`
        : `UPDATE vendor_contacts SET user_id = ?, updated_at = ?
         WHERE id = ? AND user_id IS ? AND vendor_id IN
           (SELECT id FROM vendors WHERE organization_id = ?)`,
      ["u2", now, "p1", null, "org-1"]))
      if (!audit) throw new Error("missing audit statement")
      expect(String(audit.binds[0])).toMatch(uuid)
      expect({ sql: audit.sql, binds: audit.binds.slice(1) }).toEqual(expectedShape(
        `INSERT INTO contact_account_link_events
         (id, organization_id, person_kind, person_id, previous_user_id,
          next_user_id, changed_by_user_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        ["org-1", kind, "p1", null, "u2", "u1", now],
      ))
    }
  })
})
