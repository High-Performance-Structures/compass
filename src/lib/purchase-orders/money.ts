export function formatPurchaseOrderMoney(value: number | null): string {
  if (value === null) return "Amount TBD"

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
