/*
 * The contact directory: project contacts and where they came from,
 * customers and vendors with their people, staff (internal contacts) and
 * their private addresses, duplicate merge events, and account link events.
 * Written by: src/lib/domain/contacts/.
 */

import { sql } from "drizzle-orm"
import {
  check,
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { PROJECT_CONTACT_TYPES, VENDOR_1099_STATUSES } from "../lib/domain/contacts/statuses"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

export const projectContacts = sqliteTable("project_contacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  contactType: text("contact_type", { enum: PROJECT_CONTACT_TYPES }).notNull(),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  sourceEntityType: text("source_entity_type").notNull().default("manual"),
  sourceEntityId: text("source_entity_id"),
  vendorId: text("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  vendorContactId: text("vendor_contact_id").references(
    () => vendorContacts.id,
    { onDelete: "set null" }
  ),
  customerId: text("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  customerContactId: text("customer_contact_id").references(
    () => customerContacts.id,
    { onDelete: "set null" }
  ),
  internalContactId: text("internal_contact_id").references(
    () => internalContacts.id,
    { onDelete: "set null" }
  ),
  displayName: text("display_name").notNull(),
  companyName: text("company_name"),
  role: text("role"),
  trade: text("trade"),
  csiDivision: text("csi_division"),
  csiDivisionName: text("csi_division_name"),
  primaryCostCode: text("primary_cost_code"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  ownerPortalVisible: integer("owner_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  subVendorPortalVisible: integer("sub_vendor_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  internalVisible: integer("internal_visible", {
    mode: "boolean",
  }).notNull().default(true),
  primaryContact: integer("primary_contact", {
    mode: "boolean",
  }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("project_contacts_customer_contact_idx").on(table.customerContactId),
  index("project_contacts_internal_contact_idx").on(table.internalContactId),
    // Declared from drizzle/0036_project_contacts.sql.
    index("idx_project_contacts_project").on(table.projectId),
    // Declared from drizzle/0036_project_contacts.sql.
    index("idx_project_contacts_type").on(table.projectId, table.contactType),
    // Declared from drizzle/0036_project_contacts.sql.
    index("idx_project_contacts_csi").on(table.projectId, table.csiDivision),
    // Declared from drizzle/0036_project_contacts.sql.
    index("idx_project_contacts_source").on(table.sourceSystem, table.sourceRecordId),
    // Declared from drizzle/0036_project_contacts.sql.
    index("idx_project_contacts_visibility").on(table.projectId, table.ownerPortalVisible, table.subVendorPortalVisible, table.internalVisible),
    index("project_contacts_customer_id_idx").on(table.customerId),
    index("project_contacts_vendor_contact_id_idx").on(table.vendorContactId),
    index("project_contacts_vendor_id_idx").on(table.vendorId),
])

export const projectContactSourceLinks = sqliteTable("project_contact_source_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  projectContactId: text("project_contact_id").references(
    () => projectContacts.id,
    { onDelete: "set null" }
  ),
  sourceSystem: text("source_system").notNull(),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  sourceRecordNumber: text("source_record_number"),
  sourceLabel: text("source_label").notNull(),
  sourceName: text("source_name").notNull(),
  matchStatus: text("match_status").notNull().default("unmatched"),
  matchConfidence: real("match_confidence").notNull().default(0),
  matchReason: text("match_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0037_project_contact_source_links.sql.
    index("idx_project_contact_source_links_project").on(table.projectId),
    // Declared from drizzle/0037_project_contact_source_links.sql.
    index("idx_project_contact_source_links_contact").on(table.projectContactId),
    // Declared from drizzle/0037_project_contact_source_links.sql.
    index("idx_project_contact_source_links_source").on(table.sourceSystem, table.sourceRecordType, table.sourceRecordId),
    // Declared from drizzle/0037_project_contact_source_links.sql.
    index("idx_project_contact_source_links_status").on(table.projectId, table.matchStatus),
  ])

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    billingAddressLine1: text("billing_address_line_1"),
    billingAddressLine2: text("billing_address_line_2"),
    billingCity: text("billing_city"),
    billingState: text("billing_state"),
    billingPostalCode: text("billing_postal_code"),
    primaryEmail: text("primary_email"),
    notes: text("notes"),
    netsuiteId: text("netsuite_id"),
    sageClientId: text("sage_client_id"),
    sageClientNumber: text("sage_client_number"),
    sageClientStatusId: integer("sage_client_status_id"),
    buildertrendContactId: text("buildertrend_contact_id"),
    relationshipType: text("relationship_type").notNull().default("client"),
    mergedIntoCustomerId: text("merged_into_customer_id"),
    organizationId: text("organization_id").references(() => organizations.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("customers_org_sage_client_id_unique")
      .on(table.organizationId, table.sageClientId)
      .where(
        sql`${table.sageClientId} IS NOT NULL AND trim(${table.sageClientId}) <> ''`
      ),
    uniqueIndex("customers_org_sage_client_number_unique")
      .on(table.organizationId, table.sageClientNumber)
      .where(
        sql`${table.sageClientNumber} IS NOT NULL AND trim(${table.sageClientNumber}) <> ''`
      ),
    uniqueIndex("customers_org_buildertrend_contact_unique")
      .on(table.organizationId, table.buildertrendContactId)
      .where(
        sql`${table.buildertrendContactId} IS NOT NULL AND trim(${table.buildertrendContactId}) <> ''`
      ),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("customers_merged_into_customer_id_idx").on(table.mergedIntoCustomerId),
  ]
)

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Subcontractor"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  ownerName: text("owner_name"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  primaryEmail: text("primary_email"),
  sageVendorId: text("sage_vendor_id"),
  sageVendorNumber: text("sage_vendor_number"),
  netsuiteId: text("netsuite_id"),
  sourceSystem: text("source_system").notNull().default("manual"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  sourceMetadata: text("source_metadata"),
  directoryStatus: text("directory_status").notNull().default("active"),
  mergedIntoVendorId: text("merged_into_vendor_id"),
  /** Google Drive folder holding this vendor's trade docs. */
  tradeDocsFolderId: text("trade_docs_folder_id"),
  /** "flag" or "hold" bills while trade docs are missing; null uses the company default. */
  tradeDocsBillMode: text("trade_docs_bill_mode"),
  /** Whether the vendor gets a 1099 (yes, no, unknown until their W-9 is on file); sent to Sage on add. */
  form1099Status: text("form_1099_status", { enum: VENDOR_1099_STATUSES }).notNull().default("unknown"),
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (table) => [
  uniqueIndex("vendors_org_sage_vendor_id_unique")
    .on(table.organizationId, table.sageVendorId)
    .where(sql`${table.sageVendorId} IS NOT NULL AND trim(${table.sageVendorId}) <> ''`),
  uniqueIndex("vendors_org_sage_vendor_number_unique")
    .on(table.organizationId, table.sageVendorNumber)
    .where(sql`${table.sageVendorNumber} IS NOT NULL AND trim(${table.sageVendorNumber}) <> ''`),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("vendors_merged_into_vendor_id_idx").on(table.mergedIntoVendorId),
  ])

export const vendorContacts = sqliteTable(
  "vendor_contacts",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    phoneExtension: text("phone_extension"),
    cellPhone: text("cell_phone"),
    sageContactId: text("sage_contact_id"),
    sageLineNumber: integer("sage_line_number"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    mergedIntoPersonId: text("merged_into_person_id"),
    sourceSystem: text("source_system").notNull().default("manual"),
    sourceRecordId: text("source_record_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("vendor_contacts_vendor_idx").on(table.vendorId),
    index("vendor_contacts_vendor_active_idx").on(table.vendorId, table.active),
    uniqueIndex("vendor_contacts_vendor_sage_contact_unique")
      .on(table.vendorId, table.sageContactId)
      .where(sql`${table.sageContactId} IS NOT NULL AND trim(${table.sageContactId}) <> ''`),
    uniqueIndex("vendor_contacts_vendor_sage_line_unique")
      .on(table.vendorId, table.sageLineNumber)
      .where(sql`${table.sageLineNumber} IS NOT NULL`),
    uniqueIndex("vendor_contacts_company_user_unique")
      .on(table.vendorId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("vendor_contacts_user_id_idx").on(table.userId),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("vendor_contacts_merged_into_person_id_idx").on(table.mergedIntoPersonId),
  ]
)

export const customerContacts = sqliteTable(
  "customer_contacts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    phoneExtension: text("phone_extension"),
    cellPhone: text("cell_phone"),
    sageContactId: text("sage_contact_id"),
    sageLineNumber: integer("sage_line_number"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    mergedIntoPersonId: text("merged_into_person_id"),
    sourceSystem: text("source_system").notNull().default("manual"),
    sourceRecordId: text("source_record_id"),
    syncStatus: text("sync_status").notNull().default("manual"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("customer_contacts_customer_active_idx").on(
      table.customerId,
      table.active
    ),
    uniqueIndex("customer_contacts_customer_sage_contact_unique")
      .on(table.customerId, table.sageContactId)
      .where(sql`${table.sageContactId} IS NOT NULL AND trim(${table.sageContactId}) <> ''`),
    uniqueIndex("customer_contacts_customer_sage_line_unique")
      .on(table.customerId, table.sageLineNumber)
      .where(sql`${table.sageLineNumber} IS NOT NULL`),
    uniqueIndex("customer_contacts_company_user_unique")
      .on(table.customerId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("customer_contacts_user_id_idx").on(table.userId),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("customer_contacts_merged_into_person_id_idx").on(table.mergedIntoPersonId),
  ]
)

/** Immutable recovery record for directory-only duplicate merges. */
export const contactMergeEvents = sqliteTable("contact_merge_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  sourceId: text("source_id").notNull(),
  destinationId: text("destination_id").notNull(),
  sourceSnapshotJson: text("source_snapshot_json").notNull(),
  destinationSnapshotJson: text("destination_snapshot_json").notNull(),
  movedPeopleCount: integer("moved_people_count").notNull().default(0),
  movedProjectContactsCount: integer("moved_project_contacts_count").notNull().default(0),
  mergedByUserId: text("merged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  mergedAt: text("merged_at").notNull(),
}, (table) => [
  uniqueIndex("contact_merge_events_org_source_idx").on(table.organizationId, table.kind, table.sourceId),
  index("contact_merge_events_org_destination_idx").on(table.organizationId, table.kind, table.destinationId),
])

export const internalContacts = sqliteTable(
  "internal_contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    cellPhone: text("cell_phone"),
    sageEmployeeId: text("sage_employee_id"),
    sageEmployeeNumber: text("sage_employee_number"),
    sourceSystem: text("source_system").notNull().default("manual"),
    sourceRecordId: text("source_record_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    syncStatus: text("sync_status").notNull().default("manual"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("internal_contacts_org_active_idx").on(
      table.organizationId,
      table.active
    ),
    uniqueIndex("internal_contacts_org_user_unique")
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("internal_contacts_org_sage_employee_unique")
      .on(table.organizationId, table.sageEmployeeId)
      .where(sql`${table.sageEmployeeId} IS NOT NULL AND trim(${table.sageEmployeeId}) <> ''`),
    uniqueIndex("internal_contacts_org_sage_employee_number_unique")
      .on(table.organizationId, table.sageEmployeeNumber)
      .where(sql`${table.sageEmployeeNumber} IS NOT NULL AND trim(${table.sageEmployeeNumber}) <> ''`),
    index("internal_contacts_user_id_idx").on(table.userId),
  ]
)

// Employee residential addresses are never selected with ordinary directory
// people or project assignments. Access requires a dedicated private action.
export const internalContactPrivateAddresses = sqliteTable(
  "internal_contact_private_addresses",
  {
    internalContactId: text("internal_contact_id")
      .primaryKey()
      .references(() => internalContacts.id, { onDelete: "cascade" }),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    lastSyncedAt: text("last_synced_at"),
    updatedAt: text("updated_at").notNull(),
  }
)

export const contactAccountLinkEvents = sqliteTable(
  "contact_account_link_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    personKind: text("person_kind").notNull(),
    personId: text("person_id").notNull(),
    previousUserId: text("previous_user_id"),
    nextUserId: text("next_user_id"),
    changedByUserId: text("changed_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "contact_account_link_person_kind_check",
      sql`${table.personKind} IN ('client_person', 'vendor_person')`
    ),
    index("contact_account_link_events_person_idx").on(
      table.organizationId,
      table.personKind,
      table.personId,
      table.createdAt
    ),
  ]
)

export type ProjectContact = typeof projectContacts.$inferSelect

export type NewProjectContact = typeof projectContacts.$inferInsert

export type ProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferSelect

export type NewProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferInsert

export type Customer = typeof customers.$inferSelect

export type NewCustomer = typeof customers.$inferInsert

export type Vendor = typeof vendors.$inferSelect

export type NewVendor = typeof vendors.$inferInsert

export type VendorContact = typeof vendorContacts.$inferSelect

export type NewVendorContact = typeof vendorContacts.$inferInsert
