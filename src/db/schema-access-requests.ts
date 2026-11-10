/*
 * Access requests: a signed-in person asking to join a company that allows
 * requests (Settings > People > Access requests). Staff review each one,
 * link it to the person's directory record, and approve or decline it.
 * Nothing is granted until someone approves.
 * Written by: src/lib/domain/access-requests/store.ts.
 */
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { ACCESS_REQUEST_KINDS, ACCESS_REQUEST_STATUSES } from "../lib/domain/access-requests/statuses"
import { USER_ROLES } from "../lib/domain/identity/statuses"
import { customerContacts, vendorContacts } from "./schema-contacts"
import { organizations, users } from "./schema-identity"

export const organizationAccessRequests = sqliteTable(
  "organization_access_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The person asking; their email is read from their account, never copied here. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ACCESS_REQUEST_KINDS }).notNull(),
    // What the person typed on the form. Staff use it to find their directory
    // record; it is the request itself, not a copy of another row.
    companyName: text("company_name"),
    phone: text("phone"),
    jobReference: text("job_reference"),
    note: text("note"),
    status: text("status", { enum: ACCESS_REQUEST_STATUSES }).notNull().default("pending"),
    /** The directory person an approved client or vendor request was linked to. */
    customerContactId: text("customer_contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    vendorContactId: text("vendor_contact_id").references(() => vendorContacts.id, { onDelete: "set null" }),
    /** The company role an approval gave the person. */
    grantedRole: text("granted_role", { enum: USER_ROLES }),
    /** How many jobs the approval opened (the directory person's jobs at that moment). */
    grantedProjectCount: integer("granted_project_count"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One open request per person per company; decided requests stay as history.
    uniqueIndex("organization_access_requests_one_pending")
      .on(table.organizationId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("organization_access_requests_org_status_idx").on(table.organizationId, table.status, table.createdAt),
    index("organization_access_requests_user_idx").on(table.userId, table.status),
    index("organization_access_requests_customer_contact_idx").on(table.customerContactId),
    index("organization_access_requests_vendor_contact_idx").on(table.vendorContactId),
    index("organization_access_requests_decided_by_idx").on(table.decidedBy),
  ]
)

export type OrganizationAccessRequest = typeof organizationAccessRequests.$inferSelect
export type NewOrganizationAccessRequest = typeof organizationAccessRequests.$inferInsert
