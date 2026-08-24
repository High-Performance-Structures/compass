import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import {
  organizations,
  projectOperations,
  projects,
  sageCostCodes,
  users,
} from "./schema"

export const nuTechCatalogVersions = sqliteTable(
  "nutech_catalog_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    effectiveDate: text("effective_date").notNull(),
    status: text("status").notNull().default("draft"),
    newStandardSheetId: text("new_standard_sheet_id").notNull(),
    newCashSheetId: text("new_cash_sheet_id").notNull(),
    returningStandardSheetId: text("returning_standard_sheet_id").notNull(),
    returningCashSheetId: text("returning_cash_sheet_id").notNull(),
    airliteTemplateId: text("airlite_template_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    importedAt: text("imported_at").notNull(),
    importedBy: text("imported_by").references(() => users.id, {
      onDelete: "set null",
    }),
    activatedAt: text("activated_at"),
    activatedBy: text("activated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nutech_catalog_versions_org_name_uq").on(
      table.organizationId,
      table.name
    ),
    index("nutech_catalog_versions_org_status_idx").on(
      table.organizationId,
      table.status,
      table.effectiveDate
    ),
  ]
)

export const nuTechProducts = sqliteTable(
  "nutech_products",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    manufacturerSku: text("manufacturer_sku").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    origin: text("origin").notNull(),
    priceUnit: text("price_unit").notNull(),
    packageQuantity: integer("package_quantity").notNull().default(1),
    packageLabel: text("package_label").notNull(),
    minimumOrderIncrement: integer("minimum_order_increment")
      .notNull()
      .default(1),
    squareFeetPerUnitMils: integer("square_feet_per_unit_mils"),
    airliteTemplateSku: text("airlite_template_sku"),
    airliteTemplateRow: integer("airlite_template_row"),
    airliteMappingStatus: text("airlite_mapping_status")
      .notNull()
      .default("addendum_required"),
    sageCostCodeId: text("sage_cost_code_id").references(
      () => sageCostCodes.id,
      { onDelete: "set null" }
    ),
    sageMappingStatus: text("sage_mapping_status")
      .notNull()
      .default("unmapped"),
    sageMappedAt: text("sage_mapped_at"),
    sageMappedBy: text("sage_mapped_by").references(() => users.id, {
      onDelete: "set null",
    }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nutech_products_org_sku_uq").on(
      table.organizationId,
      table.manufacturerSku
    ),
    index("nutech_products_org_category_idx").on(
      table.organizationId,
      table.category,
      table.active
    ),
    index("nutech_products_sage_cost_code_idx").on(table.sageCostCodeId),
  ]
)

export const nuTechCatalogPrices = sqliteTable(
  "nutech_catalog_prices",
  {
    id: text("id").primaryKey(),
    catalogVersionId: text("catalog_version_id")
      .notNull()
      .references(() => nuTechCatalogVersions.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => nuTechProducts.id, { onDelete: "cascade" }),
    airliteCostCents: integer("airlite_cost_cents").notNull(),
    newStandardPriceCents: integer("new_standard_price_cents").notNull(),
    newCashPriceCents: integer("new_cash_price_cents").notNull(),
    returningStandardPriceCents: integer(
      "returning_standard_price_cents"
    ).notNull(),
    returningCashPriceCents: integer("returning_cash_price_cents").notNull(),
    newStandardMarginBasisPoints: integer(
      "new_standard_margin_basis_points"
    ).notNull(),
    newCashMarginBasisPoints: integer(
      "new_cash_margin_basis_points"
    ).notNull(),
    returningStandardMarginBasisPoints: integer(
      "returning_standard_margin_basis_points"
    ).notNull(),
    returningCashMarginBasisPoints: integer(
      "returning_cash_margin_basis_points"
    ).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nutech_catalog_prices_version_product_uq").on(
      table.catalogVersionId,
      table.productId
    ),
    index("nutech_catalog_prices_product_idx").on(table.productId),
  ]
)

export const nuTechOrderWorkflows = sqliteTable(
  "nutech_order_workflows",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    catalogVersionId: text("catalog_version_id").references(
      () => nuTechCatalogVersions.id,
      { onDelete: "set null" }
    ),
    customerType: text("customer_type").notNull(),
    pricingMode: text("pricing_mode").notNull(),
    quantitySource: text("quantity_source").notNull(),
    takeoffAcknowledgementStatus: text("takeoff_acknowledgement_status")
      .notNull()
      .default("not_required"),
    scopeType: text("scope_type").notNull().default("block_sale"),
    blockQuantityNotes: text("block_quantity_notes"),
    bracingIncluded: integer("bracing_included", { mode: "boolean" })
      .notNull()
      .default(false),
    bracingRentalStartDate: text("bracing_rental_start_date"),
    bracingRentalEndDate: text("bracing_rental_end_date"),
    bracingNotes: text("bracing_notes"),
    deliveryMethod: text("delivery_method").notNull().default("delivery"),
    requestedDeliveryDate: text("requested_delivery_date"),
    airlitePurchaseOrderOperationId: text(
      "airlite_purchase_order_operation_id"
    ).references(() => projectOperations.id, { onDelete: "set null" }),
    orderStatus: text("order_status").notNull().default("intake"),
    vendorConfirmationNumber: text("vendor_confirmation_number"),
    airliteWorkbookId: text("airlite_workbook_id"),
    airliteWorkbookUrl: text("airlite_workbook_url"),
    airliteWorkbookStatus: text("airlite_workbook_status")
      .notNull()
      .default("not_generated"),
    airliteWorkbookGeneratedAt: text("airlite_workbook_generated_at"),
    airliteWorkbookGeneratedBy: text(
      "airlite_workbook_generated_by"
    ).references(() => users.id, { onDelete: "set null" }),
    purchaseOrderReleasedAt: text("purchase_order_released_at"),
    purchaseOrderReleasedBy: text("purchase_order_released_by").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    vendorInvoiceNumber: text("vendor_invoice_number"),
    vendorInvoiceStatus: text("vendor_invoice_status")
      .notNull()
      .default("not_received"),
    vendorInvoiceReceivedAt: text("vendor_invoice_received_at"),
    vendorInvoiceReleasedAt: text("vendor_invoice_released_at"),
    vendorInvoiceReleasedBy: text("vendor_invoice_released_by").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nutech_order_workflows_project_uq").on(table.projectId),
    index("nutech_order_workflows_status_idx").on(
      table.orderStatus,
      table.requestedDeliveryDate
    ),
    index("nutech_order_workflows_po_idx").on(
      table.airlitePurchaseOrderOperationId
    ),
    index("nutech_order_workflows_catalog_idx").on(table.catalogVersionId),
  ]
)

export const nuTechOrderItems = sqliteTable(
  "nutech_order_items",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => nuTechOrderWorkflows.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => nuTechProducts.id, { onDelete: "restrict" }),
    catalogVersionId: text("catalog_version_id")
      .notNull()
      .references(() => nuTechCatalogVersions.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    manufacturerSkuSnapshot: text("manufacturer_sku_snapshot").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    priceUnitSnapshot: text("price_unit_snapshot").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nutech_order_items_workflow_product_uq").on(
      table.workflowId,
      table.productId
    ),
    index("nutech_order_items_workflow_sort_idx").on(
      table.workflowId,
      table.sortOrder
    ),
  ]
)

export type NuTechOrderWorkflow = typeof nuTechOrderWorkflows.$inferSelect
export type NewNuTechOrderWorkflow = typeof nuTechOrderWorkflows.$inferInsert
export type NuTechCatalogVersion = typeof nuTechCatalogVersions.$inferSelect
export type NuTechProduct = typeof nuTechProducts.$inferSelect
export type NuTechCatalogPrice = typeof nuTechCatalogPrices.$inferSelect
export type NuTechOrderItem = typeof nuTechOrderItems.$inferSelect
