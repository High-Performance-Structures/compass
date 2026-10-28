import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { organizations, users, vendors } from "./schema"

/**
 * A trade document received from a vendor. The file itself lives in Google
 * Drive; a newer document of the same type sets `supersededAt` on the older
 * one so the history stays.
 */
export const vendorTradeDocuments = sqliteTable(
  "vendor_trade_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    /** A document type id from Settings → Trade docs. */
    docType: text("doc_type").notNull(),
    /** "document", or "waiver" when the type's allowed alternative was given instead. */
    kind: text("kind").notNull().default("document"),
    driveFileId: text("drive_file_id"),
    fileName: text("file_name"),
    webUrl: text("web_url"),
    effectiveOn: text("effective_on"),
    expiresOn: text("expires_on"),
    /** Certificate checks ticked by staff: string[] of check labels. */
    checksJson: text("checks_json"),
    notes: text("notes"),
    /** "upload", "import" (brought in from Drive), "vendor_link" or "e_sign". */
    source: text("source").notNull().default("upload"),
    supersededAt: text("superseded_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("vendor_trade_documents_vendor_idx").on(table.vendorId, table.docType, table.supersededAt),
    index("vendor_trade_documents_org_expiry_idx").on(table.organizationId, table.expiresOn),
    uniqueIndex("vendor_trade_documents_drive_file_uq")
      .on(table.vendorId, table.docType, table.driveFileId)
      .where(sql`${table.driveFileId} IS NOT NULL`),
  ]
)

export type VendorTradeDocument = typeof vendorTradeDocuments.$inferSelect

/**
 * A no-login link for sending trade docs. "vendor" links are emailed by
 * staff; an "agent" link is sent on by the vendor to their insurance agent
 * and only asks for certificates. Only the token's SHA-256 hash is stored.
 */
export const vendorTradeDocLinks = sqliteTable(
  "vendor_trade_doc_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** "vendor" or "agent". */
    audience: text("audience").notNull().default("vendor"),
    recipientEmail: text("recipient_email").notNull(),
    /** string[] of document type ids asked for. */
    requestedJson: text("requested_json").notNull(),
    parentLinkId: text("parent_link_id").references((): AnySQLiteColumn => vendorTradeDocLinks.id, { onDelete: "set null" }),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, { onDelete: "set null" }),
    lastOpenedAt: text("last_opened_at"),
    lastSubmittedAt: text("last_submitted_at"),
    uploadCount: integer("upload_count").notNull().default(0),
    /** Files sent through the link go to Drive as this staff member. */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("vendor_trade_doc_links_token_uq").on(table.tokenHash),
    index("vendor_trade_doc_links_vendor_idx").on(table.vendorId, table.createdAt),
  ]
)

export type VendorTradeDocLink = typeof vendorTradeDocLinks.$inferSelect
