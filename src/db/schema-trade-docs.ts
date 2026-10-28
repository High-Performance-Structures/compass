import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
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
      .on(table.vendorId, table.driveFileId)
      .where(sql`${table.driveFileId} IS NOT NULL`),
  ]
)

export type VendorTradeDocument = typeof vendorTradeDocuments.$inferSelect
