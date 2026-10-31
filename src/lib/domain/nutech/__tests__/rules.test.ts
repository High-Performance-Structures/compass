import { describe, expect, it } from "vitest"

import {
  nuTechEffectiveTaxEntityId,
  nuTechItemTaxable,
  nuTechOrderCostCents,
  nuTechOrderTotals,
  nuTechSalesTaxCents,
  nuTechShippingCents,
  nuTechShippingInputCents,
  nuTechWorkbookStatusAfterChange,
  parseNuTechDate,
  toNuTechOrderRecord,
} from "@/lib/domain/nutech/rules"

/**
 * The math the order workspace ran inline before it moved here, copied
 * verbatim, so each case proves the numbers did not change.
 */
type LegacyItem = { readonly productId: string; readonly quantity: number; readonly unitPriceCents: number }
type LegacyProduct = { readonly id: string; readonly taxable: boolean }
type LegacyDistrict = { readonly id: string; readonly rateBasisPoints: number }

function legacyWorkspaceTotals(input: {
  readonly orderItems: readonly LegacyItem[]
  readonly catalogProducts: readonly LegacyProduct[]
  readonly taxDistricts: readonly LegacyDistrict[]
  readonly fulfillment: string
  readonly shipping: string
  readonly taxEntityId: string
  readonly warehouseTaxEntityId: string | null
  readonly shippingTaxable: boolean
}): { readonly customerTotalCents: number; readonly shippingCents: number; readonly taxCents: number; readonly totalCents: number; readonly districtId: string | null } {
  const workspace = input
  const customerTotalCents = workspace.orderItems.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0)
  const isDelivery = input.fulfillment === "delivery"
  const effectiveTaxEntityId = input.taxEntityId || (isDelivery ? "" : (workspace.warehouseTaxEntityId ?? ""))
  const taxDistrict = workspace.taxDistricts.find((district) => district.id === effectiveTaxEntityId) ?? null
  const shippingCents = isDelivery ? Math.max(0, Math.round((Number.parseFloat(input.shipping.replace(/[$,]/g, "")) || 0) * 100)) : 0
  const taxableCents =
    workspace.orderItems.reduce(
      (total, item) =>
        workspace.catalogProducts.find((product) => product.id === item.productId)?.taxable === false
          ? total
          : total + item.quantity * item.unitPriceCents,
      0
    ) + (workspace.shippingTaxable ? shippingCents : 0)
  const taxCents = taxDistrict ? Math.round((taxableCents * taxDistrict.rateBasisPoints) / 10_000) : 0
  return { customerTotalCents, shippingCents, taxCents, totalCents: customerTotalCents + shippingCents + taxCents, districtId: taxDistrict?.id ?? null }
}

/** The same inputs through the shared rules, as the workspace and server now run them. */
function sharedTotals(input: Parameters<typeof legacyWorkspaceTotals>[0]): ReturnType<typeof legacyWorkspaceTotals> {
  const districtId = nuTechEffectiveTaxEntityId({
    chosenTaxEntityId: input.taxEntityId,
    deliveryMethod: input.fulfillment,
    warehouseTaxEntityId: input.warehouseTaxEntityId,
  })
  const district = input.taxDistricts.find((candidate) => candidate.id === districtId) ?? null
  const totals = nuTechOrderTotals({
    // The server flags each item from the same price list the workspace searched.
    items: input.orderItems.map((item) => ({
      ...item,
      taxable: nuTechItemTaxable(input.catalogProducts.find((product) => product.id === item.productId)?.taxable),
    })),
    shippingCents: nuTechShippingCents(input.fulfillment, nuTechShippingInputCents(input.shipping)),
    shippingTaxable: input.shippingTaxable,
    taxRateBasisPoints: district?.rateBasisPoints ?? null,
  })
  return {
    customerTotalCents: totals.itemsCents,
    shippingCents: totals.shippingCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    districtId: district?.id ?? null,
  }
}

const DISTRICTS: readonly LegacyDistrict[] = [
  { id: "site", rateBasisPoints: 825 },
  { id: "warehouse", rateBasisPoints: 290 },
  { id: "half", rateBasisPoints: 500 },
]

const PRODUCTS: readonly LegacyProduct[] = [
  { id: "block", taxable: true },
  { id: "tie", taxable: false },
]

const BASE = {
  orderItems: [
    { productId: "block", quantity: 120, unitPriceCents: 1_895 },
    { productId: "tie", quantity: 3, unitPriceCents: 4_250 },
  ],
  catalogProducts: PRODUCTS,
  taxDistricts: DISTRICTS,
  fulfillment: "delivery",
  shipping: "450.00",
  taxEntityId: "site",
  warehouseTaxEntityId: "warehouse",
  shippingTaxable: false,
} as const

describe("Nu-Tech order totals match the workspace's former inline math", () => {
  const cases: readonly (readonly [string, Parameters<typeof legacyWorkspaceTotals>[0]])[] = [
    ["taxable and non-taxable items on a delivery", BASE],
    ["only non-taxable items", { ...BASE, orderItems: [{ productId: "tie", quantity: 10, unitPriceCents: 4_250 }] }],
    ["an item missing from the price list counts as taxable", { ...BASE, orderItems: [{ productId: "retired", quantity: 2, unitPriceCents: 999 }] }],
    ["taxable shipping (Freight marked taxable)", { ...BASE, shippingTaxable: true }],
    ["shipping typed with $ and commas", { ...BASE, shipping: "$1,250.505", shippingTaxable: true }],
    ["blank and invalid shipping", { ...BASE, shipping: "abc" }],
    ["negative shipping is ignored", { ...BASE, shipping: "-25" }],
    ["pickup with no district chosen uses the warehouse", { ...BASE, fulfillment: "customer_pickup", taxEntityId: "" }],
    ["will call with no district chosen uses the warehouse", { ...BASE, fulfillment: "will_call", taxEntityId: "" }],
    ["pickup with a chosen district keeps it", { ...BASE, fulfillment: "customer_pickup", taxEntityId: "site" }],
    ["pickup ignores shipping", { ...BASE, fulfillment: "customer_pickup", shippingTaxable: true }],
    ["delivery with no district has no tax", { ...BASE, taxEntityId: "" }],
    ["pickup with no district and no warehouse has no tax", { ...BASE, fulfillment: "customer_pickup", taxEntityId: "", warehouseTaxEntityId: null }],
    ["a district that is no longer active has no tax", { ...BASE, taxEntityId: "retired-district" }],
    ["an empty order", { ...BASE, orderItems: [] }],
  ]
  for (const [name, input] of cases) {
    it(name, () => {
      expect(sharedTotals(input)).toEqual(legacyWorkspaceTotals(input))
    })
  }

  it("rounds half a cent up, as Math.round did", () => {
    // 1 × $0.10 at 5% = 0.5¢ → 1¢; 3 × $0.10 at 5% = 1.5¢ → 2¢.
    for (const quantity of [1, 3, 5, 7]) {
      const input = { ...BASE, orderItems: [{ productId: "block", quantity, unitPriceCents: 10 }], taxEntityId: "half", shipping: "" }
      expect(sharedTotals(input)).toEqual(legacyWorkspaceTotals(input))
    }
    expect(nuTechSalesTaxCents(10, 500)).toBe(1)
    expect(nuTechSalesTaxCents(30, 500)).toBe(2)
    expect(nuTechSalesTaxCents(1_000, 825)).toBe(83)
  })

  it("computes the expected numbers for the base order", () => {
    // Items 120 × $18.95 = $2,274.00 taxable + 3 × $42.50 = $127.50 not; shipping $450 not taxed.
    expect(sharedTotals(BASE)).toEqual({
      customerTotalCents: 240_150,
      shippingCents: 45_000,
      taxCents: 18_761,
      totalCents: 303_911,
      districtId: "site",
    })
  })
})

describe("Nu-Tech rules", () => {
  it("treats only an explicit false as non-taxable", () => {
    expect(nuTechItemTaxable(false)).toBe(false)
    expect(nuTechItemTaxable(true)).toBe(true)
    expect(nuTechItemTaxable(null)).toBe(true)
    expect(nuTechItemTaxable(undefined)).toBe(true)
  })

  it("charges stored shipping on deliveries only", () => {
    expect(nuTechShippingCents("delivery", 12_500)).toBe(12_500)
    expect(nuTechShippingCents("delivery", null)).toBe(0)
    expect(nuTechShippingCents("customer_pickup", 12_500)).toBe(0)
    expect(nuTechShippingCents("will_call", 12_500)).toBe(0)
  })

  it("sums the manufacturer cost", () => {
    expect(nuTechOrderCostCents([{ quantity: 2, unitCostCents: 1_000 }, { quantity: 3, unitCostCents: 5 }])).toBe(2_015)
  })

  it("marks a filled order form stale after a change", () => {
    expect(nuTechWorkbookStatusAfterChange("generated")).toBe("stale")
    expect(nuTechWorkbookStatusAfterChange("generated_with_addendum")).toBe("stale")
    expect(nuTechWorkbookStatusAfterChange("not_generated")).toBe("not_generated")
    expect(nuTechWorkbookStatusAfterChange("stale")).toBe("stale")
  })

  it("validates calendar dates", () => {
    expect(parseNuTechDate(" 2026-10-30 ", "Requested delivery date")).toBe("2026-10-30")
    expect(parseNuTechDate("", "Requested delivery date")).toBeNull()
    expect(parseNuTechDate(null, "Requested delivery date")).toBeNull()
    expect(() => parseNuTechDate("2026-02-30", "Requested delivery date")).toThrow("Requested delivery date must be a valid date.")
    expect(() => parseNuTechDate("10/30/2026", "Customer paid date")).toThrow("Customer paid date must be a valid date.")
  })

  it("reads unknown stored values back as their defaults", () => {
    const record = toNuTechOrderRecord({
      id: "o1",
      projectId: "p1",
      orderNumber: 1,
      title: null,
      estimateId: null,
      catalogVersionId: null,
      customerType: "odd",
      pricingMode: "odd",
      quantitySource: "odd",
      takeoffAcknowledgementStatus: "odd",
      scopeType: "odd",
      blockQuantityNotes: null,
      bracingIncluded: false,
      bracingRentalStartDate: null,
      bracingRentalEndDate: null,
      bracingNotes: null,
      deliveryMethod: "odd",
      requestedDeliveryDate: null,
      customerPaidAt: null,
      customerPaymentMethod: "bitcoin",
      trailerDimensions: null,
      trailerPhotoReceivedAt: null,
      airlitePurchaseOrderOperationId: null,
      orderStatus: "odd",
      vendorConfirmationNumber: null,
      airlitePoSequence: null,
      airliteWorkbookId: null,
      airliteWorkbookUrl: null,
      airliteWorkbookStatus: "not_generated",
      airliteWorkbookGeneratedAt: null,
      airliteWorkbookGeneratedBy: null,
      purchaseOrderReleasedAt: null,
      purchaseOrderReleasedBy: null,
      vendorInvoiceNumber: null,
      vendorInvoiceStatus: "odd",
      vendorInvoiceReceivedAt: null,
      vendorInvoiceReleasedAt: null,
      vendorInvoiceReleasedBy: null,
      shippingCents: null,
      shippingNote: null,
      taxEntityId: null,
      notes: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    })
    expect(record).toMatchObject({
      customerType: "new",
      pricingMode: "standard",
      quantitySource: "customer_provided",
      takeoffAcknowledgementStatus: "pending",
      scopeType: "block_sale",
      deliveryMethod: "delivery",
      customerPaymentMethod: null,
      orderStatus: "intake",
      vendorInvoiceStatus: "not_received",
    })
  })
})
