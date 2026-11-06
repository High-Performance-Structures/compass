"use client"

import * as React from "react"
import Link from "next/link"

import type { NuTechTruckloadProduct } from "@/app/actions/nutech-truckload"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { nuTechTruckload, nuTechTruckloadLabel } from "@/lib/nutech/truckload"
import { cn } from "@/lib/utils"

/** Block width in inches from a Fox Blocks SKU (FOX-S800 → 8, FOX-EC1090 → 10), for sorting. */
function blockWidth(sku: string): number {
  const digits = /\d+/.exec(sku)?.[0]
  if (!digits) return Number.MAX_SAFE_INTEGER
  return Number(digits.length >= 4 ? digits.slice(0, 2) : digits.slice(0, 1))
}

function bundleCount(text: string | undefined): number {
  const value = Number(text)
  return Number.isInteger(value) && value > 0 ? value : 0
}

/**
 * What-if truckload math, like the old Truckload Calculator sheet: type
 * bundles per product and see the share of a manufacturer truck. Nothing is
 * saved; orders show their own share on the job.
 */
export function NuTechTruckloadCalculator({
  products,
}: {
  readonly products: readonly NuTechTruckloadProduct[]
}): React.ReactElement {
  const [bundles, setBundles] = React.useState<Readonly<Record<string, string>>>({})
  const sorted = React.useMemo(
    () => [...products].sort((a, b) => blockWidth(a.manufacturerSku) - blockWidth(b.manufacturerSku) || a.manufacturerSku.localeCompare(b.manufacturerSku)),
    [products],
  )
  const truck = nuTechTruckload(
    products.map((product) => ({
      manufacturerSku: product.manufacturerSku,
      category: product.category,
      // Entered in bundles, so the quantity is already in packages.
      quantity: bundleCount(bundles[product.id]),
      priceUnit: "bundle",
      packageQuantity: product.packageQuantity,
      bundlesPerTruckload: product.bundlesPerTruckload,
    })),
  )
  const fraction = truck?.fraction ?? 0

  if (products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No products have a truckload size yet. Set <span className="font-medium">Bundles / truck</span> on the{" "}
        <Link href="/dashboard/nutech/catalog" className="text-primary hover:underline">Nu-Tech price list</Link>.
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-live="polite" className="sticky top-0 z-10 space-y-2 border-b bg-background py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={cn("text-lg font-semibold", fraction > 1 && "text-warning")}>
            {truck ? nuTechTruckloadLabel(fraction) : "Enter bundles to see the truckload."}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={!truck} onClick={() => setBundles({})}>
            Clear
          </Button>
        </div>
        <Progress value={Math.min(100, fraction * 100)} aria-label="Share of a full truckload" />
        <p className="text-xs text-muted-foreground">
          {fraction > 1
            ? "More than one truck. Split the order or plan a second load."
            : truck
              ? `About ${Math.max(0, Math.round((1 - fraction) * 100))}% of the truck is still open.`
              : "Each order also shows its own share under its products."}
        </p>
      </section>

      <div className="overflow-x-auto border-y">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 text-right font-medium">Pieces / bundle</th>
              <th className="px-2 py-2 text-right font-medium">Bundles / truck</th>
              <th className="px-2 py-2 text-right font-medium">Bundles</th>
              <th className="px-2 py-2 text-right font-medium">Pieces</th>
              <th className="px-2 py-2 text-right font-medium">% of truck</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((product) => {
              const count = bundleCount(bundles[product.id])
              return (
                <tr key={product.id}>
                  <td className="px-2 py-2">
                    <p className="font-medium">{product.manufacturerSku}</p>
                    <p className="text-xs text-muted-foreground">{product.name}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{product.packageQuantity}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{product.bundlesPerTruckload}</td>
                  <td className="px-2 py-2 text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={bundles[product.id] ?? ""}
                      placeholder="0"
                      aria-label={`Bundles of ${product.manufacturerSku}`}
                      className="ml-auto h-9 w-20 text-right tabular-nums"
                      onChange={(event) => setBundles((current) => ({ ...current, [product.id]: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {count > 0 ? count * product.packageQuantity : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {count > 0 ? `${Math.round((count / product.bundlesPerTruckload) * 1000) / 10}%` : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Products without a truckload size aren&apos;t listed. Set <span className="font-medium">Bundles / truck</span> on the{" "}
        <Link href="/dashboard/nutech/catalog" className="text-primary hover:underline">Nu-Tech price list</Link>.
      </p>
    </div>
  )
}
