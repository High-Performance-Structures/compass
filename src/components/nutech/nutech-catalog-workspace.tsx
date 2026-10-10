"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import {
  IconCheck,
  IconDatabaseImport,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  activateNuTechCatalogVersion,
  deleteNuTechCatalogVersion,
  importNuTech2026Catalog,
  mapNuTechProductToSageCostCode,
  type NuTechCatalogWorkspace,
} from "@/app/actions/nutech-catalog"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { SortableTh, useTableSort } from "@/components/ui/sortable-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

type Product = NuTechCatalogWorkspace["products"][number]
type ProductSortKey = "sku" | "package" | "cost" | "newStandard" | "newCash" | "returning" | "returningCash" | "form" | "costCode"

const PRODUCT_SORT: Readonly<Record<ProductSortKey, (product: Product) => string | number | null>> = {
  sku: (product) => product.manufacturerSku,
  package: (product) => product.packageLabel,
  cost: (product) => product.airliteCostCents,
  newStandard: (product) => product.newStandardPriceCents,
  newCash: (product) => product.newCashPriceCents,
  returning: (product) => product.returningStandardPriceCents,
  returningCash: (product) => product.returningCashPriceCents,
  form: (product) => product.airliteTemplateRow,
  costCode: (product) => product.sageCostCodeLabel,
}

export function NuTechCatalogWorkspacePanel({
  workspace,
}: {
  readonly workspace: NuTechCatalogWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { rows: products, sort, toggle } = useTableSort(workspace.products, PRODUCT_SORT)

  function importCatalog(): void {
    startTransition(async () => {
      const result = await importNuTech2026Catalog()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Imported ${result.productCount ?? 0} Nu-Tech products.`)
      router.refresh()
    })
  }

  function activateCatalog(versionId: string): void {
    startTransition(async () => {
      const result = await activateNuTechCatalogVersion(versionId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech catalog activated.")
      router.refresh()
    })
  }

  function deleteCatalog(versionId: string): void {
    if (!window.confirm("Delete this draft Nu-Tech catalog version?")) return
    startTransition(async () => {
      const result = await deleteNuTechCatalogVersion(versionId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Draft catalog deleted.")
      router.refresh()
    })
  }

  function mapSageCostCode(productId: string, value: string): void {
    startTransition(async () => {
      const result = await mapNuTechProductToSageCostCode(
        productId,
        value.length > 0 ? value : null
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage mapping updated.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Catalog versions</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Imports validate all four published 2026 price sheets against the
              same Airlite cost and SKU list before anything can be activated.
            </p>
          </div>
          {workspace.canImport && (
            <Button onClick={importCatalog} disabled={isPending}>
              <IconDatabaseImport className="size-4" />
              Import 2026 catalog
            </Button>
          )}
        </div>
        <div className="mt-4 divide-y border-y">
          {workspace.versions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No catalog version has been imported.
            </p>
          ) : (
            workspace.versions.map((version) => (
              <div
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{version.name}</p>
                    <Badge
                      variant={version.status === "active" ? "default" : "secondary"}
                    >
                      {version.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Effective {version.effectiveDate} · {version.productCount} products
                  </p>
                </div>
                <div className="flex gap-2">
                  {workspace.canImport && version.status !== "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending || version.productCount === 0}
                      onClick={() => activateCatalog(version.id)}
                    >
                      <IconCheck className="size-4" />
                      Activate
                    </Button>
                  )}
                  {workspace.canDelete && version.status === "draft" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={() => deleteCatalog(version.id)}
                    >
                      <IconTrash className="size-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-background">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">Active product catalog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Published customer prices are versioned. Sage mappings remain optional
            until the matching cost code exists and is deliberately selected.
          </p>
        </div>
        {workspace.products.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Activate an imported catalog to review its products.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead className="border-b bg-muted/40 text-muted-foreground">
                <tr>
                  <SortableTh sortKey="sku" sort={sort} onSort={toggle} className="px-3 py-2 font-medium">SKU / product</SortableTh>
                  <SortableTh sortKey="package" sort={sort} onSort={toggle} className="px-3 py-2 font-medium">Package</SortableTh>
                  <SortableTh sortKey="cost" sort={sort} onSort={toggle} align="right" className="px-3 py-2 text-right font-medium">Airlite cost</SortableTh>
                  <SortableTh sortKey="newStandard" sort={sort} onSort={toggle} align="right" className="px-3 py-2 text-right font-medium">New standard</SortableTh>
                  <SortableTh sortKey="newCash" sort={sort} onSort={toggle} align="right" className="px-3 py-2 text-right font-medium">New cash</SortableTh>
                  <SortableTh sortKey="returning" sort={sort} onSort={toggle} align="right" className="px-3 py-2 text-right font-medium">Returning</SortableTh>
                  <SortableTh sortKey="returningCash" sort={sort} onSort={toggle} align="right" className="px-3 py-2 text-right font-medium">Returning cash</SortableTh>
                  <SortableTh sortKey="form" sort={sort} onSort={toggle} className="px-3 py-2 font-medium">Airlite form</SortableTh>
                  <SortableTh sortKey="costCode" sort={sort} onSort={toggle} className="px-3 py-2 font-medium">Sage cost code</SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium">{product.manufacturerSku}</p>
                      <p className="mt-0.5 text-muted-foreground">{product.name}</p>
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {product.packageLabel} · {product.priceUnit}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {money(product.airliteCostCents)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {money(product.newStandardPriceCents)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {money(product.newCashPriceCents)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {money(product.returningStandardPriceCents)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {money(product.returningCashPriceCents)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge
                        variant={
                          product.airliteMappingStatus === "mapped"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {product.airliteTemplateRow
                          ? `Row ${product.airliteTemplateRow}`
                          : "Addendum"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {workspace.canImport ? (
                        <SearchableCombobox
                          className="h-9"
                          // A code missing from the list shows as unmapped
                          // instead of letting the picker's reset unmap it.
                          value={
                            workspace.sageCostCodes.some(
                              (costCode) => costCode.id === product.sageCostCodeId
                            )
                              ? (product.sageCostCodeId ?? "")
                              : ""
                          }
                          disabled={isPending}
                          onValueChange={(value) => {
                            if (value !== (product.sageCostCodeId ?? "")) {
                              mapSageCostCode(product.id, value)
                            }
                          }}
                          options={[
                            { value: "", label: "Not mapped" },
                            ...workspace.sageCostCodes.map((costCode) => ({
                              value: costCode.id,
                              label: costCode.displayLabel,
                            })),
                          ]}
                          ariaLabel={`Sage cost code for ${product.name}`}
                          placeholder="Not mapped"
                          searchPlaceholder="Search cost codes..."
                          emptyMessage="No matching cost codes."
                        />
                      ) : (
                        <span className="text-muted-foreground">
                          {product.sageCostCodeLabel ?? "Not mapped"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
