import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { organizations, projects, users, vendors } from "./schema"

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
    index("vendor_trade_doc_links_parent_link_id_idx").on(table.parentLinkId),
    index("vendor_trade_doc_links_organization_id_idx").on(table.organizationId),
  ]
)

export type VendorTradeDocLink = typeof vendorTradeDocLinks.$inferSelect

/**
 * A letter of intent or award letter sent to a selected trade for one
 * estimate's accepted bid. The award letter is the written acceptance of the
 * quote under the trade's master agreement; when the trade has no signed
 * agreement yet it can ride along in the same envelope. Signed through Foxit.
 */
export const tradeLetters = sqliteTable(
  "trade_letters",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    estimateId: text("estimate_id").notNull(),
    /** The RFQ whose accepted bid this letter awards. */
    rfqOperationId: text("rfq_operation_id").notNull(),
    vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    vendorName: text("vendor_name").notNull(),
    /** "intent" or "award". */
    kind: text("kind").notNull(),
    letterNumber: text("letter_number").notNull(),
    /** "draft", "preparing", "sent", "signed", "declined" or "cancelled". */
    status: text("status").notNull().default("draft"),
    /** { costCode, description, amountCents }[] awarded by this letter. */
    scopeJson: text("scope_json").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** How the letter names the quote, e.g. "RFQ-0028, dated October 22, 2026". */
    quoteLabel: text("quote_label").notNull(),
    /** Document labels still owed when the letter was written. */
    owedJson: text("owed_json").notNull().default("[]"),
    note: text("note"),
    includesAgreement: integer("includes_agreement", { mode: "boolean" }).notNull().default(false),
    agreementDriveFileId: text("agreement_drive_file_id"),
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email").notNull(),
    companySignerName: text("company_signer_name").notNull(),
    companySignerEmail: text("company_signer_email").notNull(),
    companySignerTitle: text("company_signer_title"),
    foxitEnvelopeId: text("foxit_envelope_id"),
    foxitEmbeddedSessionUrl: text("foxit_embedded_session_url"),
    sentAt: text("sent_at"),
    signedAt: text("signed_at"),
    /** The signed copy saved to the vendor's Drive folder. */
    signedDriveFileId: text("signed_drive_file_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("trade_letters_estimate_idx").on(table.projectId, table.estimateId, table.rfqOperationId),
    uniqueIndex("trade_letters_envelope_uq").on(table.foxitEnvelopeId).where(sql`${table.foxitEnvelopeId} IS NOT NULL`),
    uniqueIndex("trade_letters_number_uq").on(table.organizationId, table.letterNumber),
    index("trade_letters_vendor_id_idx").on(table.vendorId),
  ]
)

export type TradeLetter = typeof tradeLetters.$inferSelect
