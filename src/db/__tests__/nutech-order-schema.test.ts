import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  nuTechCatalogPrices,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
} from "@/db/schema-nutech"

describe("Nu-Tech order persistence contract", () => {
  it("stores one workflow per project with linked Compass PO and release audit fields", () => {
    expect(nuTechOrderWorkflows.projectId.name).toBe("project_id")
    expect(nuTechOrderWorkflows.airlitePurchaseOrderOperationId.name).toBe(
      "airlite_purchase_order_operation_id"
    )
    expect(nuTechOrderWorkflows.purchaseOrderReleasedBy.name).toBe(
      "purchase_order_released_by"
    )
    expect(nuTechOrderWorkflows.vendorInvoiceReleasedBy.name).toBe(
      "vendor_invoice_released_by"
    )
  })

  it("ships the project uniqueness and workflow indexes", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0130_nutech_orders_catalog.sql"),
      "utf8"
    )
    expect(migration).toContain("nutech_order_workflows_project_uq")
    expect(migration).toContain("nutech_order_workflows_status_idx")
    expect(migration).toContain("ON DELETE set null")
  })

  it("keeps catalog identity, price versions, order snapshots, and Sage mappings separate", () => {
    expect(nuTechProducts.manufacturerSku.name).toBe("manufacturer_sku")
    expect(nuTechProducts.sageCostCodeId.name).toBe("sage_cost_code_id")
    expect(nuTechCatalogPrices.airliteCostCents.name).toBe("airlite_cost_cents")
    expect(nuTechOrderItems.unitPriceCents.name).toBe("unit_price_cents")
    expect(nuTechOrderItems.productNameSnapshot.name).toBe(
      "product_name_snapshot"
    )
  })
})
