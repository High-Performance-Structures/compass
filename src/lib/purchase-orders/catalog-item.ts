/** A price-list item a PO line can be chosen from. */
export type PurchaseOrderCatalogItem = {
  readonly id: string
  /** Line description, e.g. "SKU Product name". */
  readonly description: string
  readonly unit: string
  /** Cost per unit, in dollars. */
  readonly unitCost: number
  readonly costCode: string | null
  /** Shown under the label in the picker. */
  readonly detail: string
}
