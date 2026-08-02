import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, projects, users } from "./schema"

export const sageTaxEntities = sqliteTable(
  "sage_tax_entities",
  {
    id: text("id").primaryKey(),
    sourceRecordId: text("source_record_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    syncStatus: text("sync_status").notNull().default("synced"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sage_tax_entities_code_uq").on(table.code),
    index("sage_tax_entities_active_idx").on(table.active, table.name),
  ]
)

export const estimateTermsTemplates = sqliteTable(
  "estimate_terms_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("estimate_terms_templates_org_name_uq").on(
      table.organizationId,
      table.name
    ),
    index("estimate_terms_templates_org_active_idx").on(
      table.organizationId,
      table.active
    ),
  ]
)

export const projectEstimates = sqliteTable(
  "project_estimates",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    estimateNumber: text("estimate_number").notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    title: text("title").notNull().default("CA22 Construction Estimate"),
    status: text("status").notNull().default("draft"),
    estimateDate: text("estimate_date"),
    clientName: text("client_name"),
    sourceSystem: text("source_system").notNull().default("compass"),
    sourceWorkbookId: text("source_workbook_id"),
    sourceWorkbookUrl: text("source_workbook_url"),
    sourceRevision: text("source_revision"),
    defaultTaxEntityId: text("default_tax_entity_id").references(
      () => sageTaxEntities.id,
      { onDelete: "set null" }
    ),
    defaultTaxCode: text("default_tax_code"),
    defaultTaxName: text("default_tax_name"),
    defaultTaxRateBasisPoints: integer("default_tax_rate_basis_points")
      .notNull()
      .default(0),
    termsTemplateId: text("terms_template_id").references(
      () => estimateTermsTemplates.id,
      { onDelete: "set null" }
    ),
    contractTerms: text("contract_terms"),
    directCostCents: integer("direct_cost_cents").notNull().default(0),
    markupCents: integer("markup_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    estimateTotalCents: integer("estimate_total_cents").notNull().default(0),
    foxitStatus: text("foxit_status").notNull().default("not_started"),
    foxitEnvelopeId: text("foxit_envelope_id"),
    signaturePackageUrl: text("signature_package_url"),
    signatureRequestedAt: text("signature_requested_at"),
    signedAt: text("signed_at"),
    acceptedAt: text("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    sageStatus: text("sage_status").notNull().default("not_ready"),
    sageRecordId: text("sage_record_id"),
    lastSageSyncAt: text("last_sage_sync_at"),
    sourceHash: text("source_hash"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_estimates_project_number_version_uq").on(
      table.projectId,
      table.estimateNumber,
      table.versionNumber
    ),
    index("project_estimates_project_status_idx").on(
      table.projectId,
      table.status,
      table.versionNumber
    ),
  ]
)

export const projectEstimateLines = sqliteTable(
  "project_estimate_lines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => projectEstimates.id, { onDelete: "cascade" }),
    divisionCode: text("division_code").notNull(),
    divisionName: text("division_name").notNull(),
    costCode: text("cost_code").notNull(),
    costCodeName: text("cost_code_name").notNull(),
    description: text("description").notNull(),
    specifications: text("specifications"),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit").notNull().default("LS"),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    directCostCents: integer("direct_cost_cents").notNull().default(0),
    markupRateBasisPoints: integer("markup_rate_basis_points")
      .notNull()
      .default(0),
    markupCents: integer("markup_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    taxEntityId: text("tax_entity_id").references(() => sageTaxEntities.id, {
      onDelete: "set null",
    }),
    taxCode: text("tax_code"),
    taxName: text("tax_name"),
    taxRateBasisPoints: integer("tax_rate_basis_points").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    lineTotalCents: integer("line_total_cents").notNull().default(0),
    ownerVisible: integer("owner_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_estimate_lines_estimate_order_idx").on(
      table.estimateId,
      table.divisionCode,
      table.sortOrder
    ),
    index("project_estimate_lines_project_cost_code_idx").on(
      table.projectId,
      table.costCode
    ),
  ]
)

export const projectEstimateBasisDocuments = sqliteTable(
  "project_estimate_basis_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => projectEstimates.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    documentDate: text("document_date"),
    revision: text("revision"),
    driveFileId: text("drive_file_id"),
    driveUrl: text("drive_url"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_estimate_basis_documents_estimate_idx").on(
      table.estimateId,
      table.sortOrder
    ),
  ]
)

export const projectContractBudgetRevisions = sqliteTable(
  "project_contract_budget_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    acceptedEstimateId: text("accepted_estimate_id")
      .notNull()
      .references(() => projectEstimates.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    status: text("status").notNull().default("current"),
    originalContractSumCents: integer("original_contract_sum_cents")
      .notNull()
      .default(0),
    approvedChangesCents: integer("approved_changes_cents")
      .notNull()
      .default(0),
    revisedContractSumCents: integer("revised_contract_sum_cents")
      .notNull()
      .default(0),
    effectiveAt: text("effective_at").notNull(),
    sourceHash: text("source_hash").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_contract_budget_revision_number_uq").on(
      table.projectId,
      table.revisionNumber
    ),
    uniqueIndex("project_contract_budget_source_hash_uq").on(
      table.projectId,
      table.sourceHash
    ),
    index("project_contract_budget_current_idx").on(
      table.projectId,
      table.status,
      table.revisionNumber
    ),
  ]
)

export const projectContractBudgetLines = sqliteTable(
  "project_contract_budget_lines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => projectContractBudgetRevisions.id, {
        onDelete: "cascade",
      }),
    sourceEstimateLineId: text("source_estimate_line_id").references(
      () => projectEstimateLines.id,
      { onDelete: "set null" }
    ),
    divisionCode: text("division_code").notNull(),
    divisionName: text("division_name").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description").notNull(),
    originalEstimateCents: integer("original_estimate_cents")
      .notNull()
      .default(0),
    approvedChangeCents: integer("approved_change_cents")
      .notNull()
      .default(0),
    adjustedBudgetCents: integer("adjusted_budget_cents")
      .notNull()
      .default(0),
    ownerVisible: integer("owner_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_contract_budget_line_cost_code_uq").on(
      table.revisionId,
      table.costCode
    ),
    index("project_contract_budget_lines_project_idx").on(
      table.projectId,
      table.revisionId
    ),
  ]
)

export const projectContractBudgetAdjustments = sqliteTable(
  "project_contract_budget_adjustments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => projectContractBudgetRevisions.id, {
        onDelete: "cascade",
      }),
    changeOrderId: text("change_order_id").notNull(),
    changeOrderLineId: text("change_order_line_id").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    executedAt: text("executed_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_contract_budget_adjustment_line_uq").on(
      table.revisionId,
      table.changeOrderLineId
    ),
    index("project_contract_budget_adjustments_change_order_idx").on(
      table.projectId,
      table.changeOrderId
    ),
  ]
)

export type ProjectEstimate = typeof projectEstimates.$inferSelect
export type ProjectEstimateLine = typeof projectEstimateLines.$inferSelect
export type ProjectEstimateBasisDocument =
  typeof projectEstimateBasisDocuments.$inferSelect
export type ProjectContractBudgetRevision =
  typeof projectContractBudgetRevisions.$inferSelect
export type ProjectContractBudgetLine =
  typeof projectContractBudgetLines.$inferSelect
