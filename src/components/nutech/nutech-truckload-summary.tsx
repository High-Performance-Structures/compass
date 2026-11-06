import * as React from "react"
import Link from "next/link"

import type { ProjectNuTechOrderWorkspace } from "@/app/actions/nutech-orders"
import { nuTechTruckload, nuTechTruckloadLabel } from "@/lib/nutech/truckload"

/** What share of a manufacturer truck the order's products take, from the price list's bundle sizes. */
export function NuTechTruckloadSummary({
  workspace,
}: {
  readonly workspace: Pick<ProjectNuTechOrderWorkspace, "orderItems" | "catalogProducts">
}): React.ReactElement | null {
  const truck = nuTechTruckload(
    workspace.orderItems.flatMap((item) => {
      const product = workspace.catalogProducts.find((option) => option.id === item.productId)
      return product
        ? [{
            manufacturerSku: item.manufacturerSku,
            category: product.category,
            quantity: item.quantity,
            priceUnit: item.priceUnit,
            packageQuantity: product.packageQuantity,
            bundlesPerTruckload: product.bundlesPerTruckload,
          }]
        : []
    }),
  )
  if (!truck) return null
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="font-medium">Truck: </span>
        {nuTechTruckloadLabel(truck.fraction)}
      </p>
      <p className="text-xs text-muted-foreground">
        {truck.lines.map((line) => `${line.manufacturerSku} ${line.bundles} of ${line.bundlesPerTruckload} bundles`).join(" + ")}
      </p>
      {truck.missingSkus.length > 0 ? (
        <p className="text-xs text-warning">
          Not counted: {truck.missingSkus.join(", ")} (no bundles per truckload on the{" "}
          <Link href="/dashboard/nutech/catalog" className="text-primary hover:underline">product catalog</Link>).
        </p>
      ) : null}
    </div>
  )
}
