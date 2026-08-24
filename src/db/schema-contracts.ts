import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, projects, users } from "./schema"
import { projectEstimates } from "./schema-estimates"

export const contractDocumentTemplates = sqliteTable(
  "contract_document_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("exhibit"),
    signingStage: text("signing_stage").notNull().default("contract"),
    defaultInclusionMode: text("default_inclusion_mode")
      .notNull()
      .default("embedded"),
    departmentCodesJson: text("department_codes_json").notNull().default("[]"),
    sourceWorkbookId: text("source_workbook_id"),
    sourceSheetNamesJson: text("source_sheet_names_json"),
    sourceUrl: text("source_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("contract_document_templates_org_code_uq").on(
      table.organizationId,
      table.code
    ),
    index("contract_document_templates_org_order_idx").on(
      table.organizationId,
      table.active,
      table.sortOrder
    ),
  ]
)

export const contractDocumentTemplateVersions = sqliteTable(
  "contract_document_template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => contractDocumentTemplates.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    contentMarkdown: text("content_markdown").notNull(),
    sourceFingerprint: text("source_fingerprint"),
    sourceCapturedAt: text("source_captured_at"),
    driveDocumentId: text("drive_document_id"),
    driveDocumentUrl: text("drive_document_url"),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("contract_document_template_versions_number_uq").on(
      table.templateId,
      table.versionNumber
    ),
    index("contract_document_template_versions_status_idx").on(
      table.templateId,
      table.status,
      table.versionNumber
    ),
  ]
)

export const contractPackets = sqliteTable(
  "contract_packets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => projectEstimates.id, { onDelete: "restrict" }),
    packetNumber: text("packet_number").notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    title: text("title").notNull().default("Construction Contract"),
    status: text("status").notNull().default("draft"),
    legalEntityName: text("legal_entity_name").notNull(),
    contractDraftDate: text("contract_draft_date"),
    approximateCommencementDate: text("approximate_commencement_date"),
    approximateCompletionDate: text("approximate_completion_date"),
    depositRateBasisPoints: integer("deposit_rate_basis_points")
      .notNull()
      .default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    latePaymentRateBasisPoints: integer("late_payment_rate_basis_points")
      .notNull()
      .default(1200),
    detailsJson: text("details_json").notNull().default("{}"),
    clientSignersJson: text("client_signers_json").notNull().default("[]"),
    companySignerName: text("company_signer_name"),
    companySignerTitle: text("company_signer_title"),
    companySignerEmail: text("company_signer_email"),
    companySignerInitials: text("company_signer_initials"),
    foxitStatus: text("foxit_status").notNull().default("not_started"),
    foxitEnvelopeId: text("foxit_envelope_id"),
    foxitEmbeddedSessionUrl: text("foxit_embedded_session_url"),
    preparedSourceHash: text("prepared_source_hash"),
    preparedAt: text("prepared_at"),
    signatureRequestedAt: text("signature_requested_at"),
    signaturePackageUrl: text("signature_package_url"),
    signedAt: text("signed_at"),
    acceptanceMethod: text("acceptance_method"),
    acceptanceEvidenceLabel: text("acceptance_evidence_label"),
    acceptanceRecordedByName: text("acceptance_recorded_by_name"),
    acceptedAt: text("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceHash: text("source_hash"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("contract_packets_project_number_version_uq").on(
      table.projectId,
      table.packetNumber,
      table.versionNumber
    ),
    index("contract_packets_project_status_idx").on(
      table.projectId,
      table.status,
      table.versionNumber
    ),
    uniqueIndex("contract_packets_foxit_envelope_uq").on(table.foxitEnvelopeId),
  ]
)

export const contractPacketDocuments = sqliteTable(
  "contract_packet_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packetId: text("packet_id")
      .notNull()
      .references(() => contractPackets.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => contractDocumentTemplates.id, {
      onDelete: "set null",
    }),
    templateVersionId: text("template_version_id").references(
      () => contractDocumentTemplateVersions.id,
      { onDelete: "set null" }
    ),
    code: text("code").notNull(),
    title: text("title").notNull(),
    contentMarkdown: text("content_markdown").notNull().default(""),
    inclusionMode: text("inclusion_mode").notNull().default("embedded"),
    signingStage: text("signing_stage").notNull().default("contract"),
    signaturePolicy: text("signature_policy").notNull().default("all_signers"),
    documentDate: text("document_date"),
    revision: text("revision"),
    sourceUrl: text("source_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("contract_packet_documents_packet_order_idx").on(
      table.packetId,
      table.sortOrder
    ),
    index("contract_packet_documents_project_idx").on(
      table.projectId,
      table.packetId
    ),
  ]
)

export type ContractDocumentTemplate =
  typeof contractDocumentTemplates.$inferSelect
export type ContractDocumentTemplateVersion =
  typeof contractDocumentTemplateVersions.$inferSelect
export type ContractPacket = typeof contractPackets.$inferSelect
export type ContractPacketDocument = typeof contractPacketDocuments.$inferSelect
