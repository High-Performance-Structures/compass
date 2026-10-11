"use client"

import Link from "next/link"
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
  importNuTechCatalog,
  mapNuTechProductToSageCostCode,
  setNuTechProductTaxable,
  type NuTechCatalogWorkspace,
  type NuTechProductCostCodeMapping,
} from "@/app/actions/nutech-catalog"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  NUTECH_RESOURCE_LINKS,
} from "@/lib/nutech/resources"
import { SortableTh, useTableSort } from "@/components/ui/sortable-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

type Product = NuTechCatalogWorkspace["products"][number]
type ProductSortKey = "sku" | "package" | "cost" | "newStandard" | "newCash" | "returning" | "returningCash" | "form" | "costCode" | "taxable"

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
  taxable: (product) => (product.taxable ? 1 : 0),
}

// Picker values: a numbered Sage code by id, or a named company code by name.
function mappingValue(product: Product): string {
  if (product.sageCostCodeId) return `sage:${product.sageCostCodeId}`
  if (product.sageCostCodeName) return `named:${product.sageCostCodeName}`
  return ""
}

function mappingFromValue(value: string): NuTechProductCostCodeMapping {
  if (value.startsWith("sage:")) return { kind: "sage", id: value.slice("sage:".length) }
  if (value.startsWith("named:")) return { kind: "named", name: value.slice("named:".length) }
  return null
}

function PriceCell({ product, cents }: { readonly product: Product; readonly cents: number }): React.ReactElement {
  return (
    <td className="px-3 py-2 text-right align-top">
      {product.quotedPerOrder ? <span className="text-muted-foreground">Quoted</span> : money(cents)}
    </td>
  )
}

function sheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

const PRICE_SOURCES_SETTINGS_HREF = "/dashboard/settings?section=workflows&workflow=nutech-catalog"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Where the active prices come from, and how staff update them. */
function CatalogSourcePanel({
  workspace,
}: {
  readonly workspace: NuTechCatalogWorkspace
}): React.ReactElement {
  const active = workspace.versions.find((version) => version.id === workspace.activeVersionId)
  const sources = workspace.priceSources
  return (
    <section aria-labelledby="nutech-price-source" className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="nutech-price-source" className="text-sm font-semibold">
          Where these prices come from
        </h2>
        {workspace.canEditPriceSources && (
          <Button asChild size="sm" variant="outline">
            <Link href={PRICE_SOURCES_SETTINGS_HREF}>Change price sheets</Link>
          </Button>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {active
          ? `In use: ${active.name}, effective ${active.effectiveDate}, imported ${formatDate(active.importedAt)}${active.activatedAt ? ` and activated ${formatDate(active.activatedAt)}` : ""}.`
          : "No catalog version is active yet."}{" "}
        The next import reads “{sources.catalogName}” (effective {sources.effectiveDate}) from the “{sources.sourceTab}” tab of these Google Sheets, with costs and SKUs from the{" "}
        <a className="underline underline-offset-2" href={NUTECH_RESOURCE_LINKS.airliteOrderForm} target="_blank" rel="noreferrer">
          Airlite order form
        </a>
        :
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {sources.sheets.map((sheet) => (
          <li key={sheet.label}>
            {sheet.id ? (
              <a className="underline underline-offset-2" href={sheetUrl(sheet.id)} target="_blank" rel="noreferrer">
                {sheet.label}
              </a>
            ) : (
              <span className="text-destructive">{sheet.label}: link missing in Settings</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Folders:{" "}
        <a className="underline underline-offset-2" href={NUTECH_RESOURCE_LINKS.newClientPricing} target="_blank" rel="noreferrer">
          New client pricing
        </a>
        {" · "}
        <a className="underline underline-offset-2" href={NUTECH_RESOURCE_LINKS.returningCustomerPricing} target="_blank" rel="noreferrer">
          Returning customer pricing
        </a>
        {" · "}
        <a className="underline underline-offset-2" href={NUTECH_RESOURCE_LINKS.pricingArchive} target="_blank" rel="noreferrer">
          Pricing archive
        </a>
      </p>

      <h3 className="mt-4 text-sm font-semibold">To update pricing</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Change the prices on the “{sources.sourceTab}” tab of the sheet(s) above. Keep the layout (a
          “Target gross margin” row, and a header row with Origin in column A and SKU in column C), and
          keep the same SKUs in all four sheets and the Airlite order form.
        </li>
        <li>
          Here, select <span className="font-medium text-foreground">Import catalog</span>.
          Compass reads all four sheets and adds a <span className="font-medium text-foreground">draft</span> version
          if anything changed.
        </li>
        <li>Check the draft’s products and prices below.</li>
        <li>
          Select <span className="font-medium text-foreground">Activate</span> on the draft. New order lines use the
          active prices; lines already on an order keep the price they were added at.
        </li>
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        {workspace.canImport
          ? "Importing and activating need Nu-Tech approval access, which you have."
          : "Importing and activating need Nu-Tech approval access; ask an administrator if you need to update prices."}{" "}
        For a new price year, an administrator points Compass at the new sheets in Settings → Workflows →
        Nu-Tech product catalog, then imports and activates as above.
      </p>
    </section>
  )
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
      const result = await importNuTechCatalog()
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

  function setTaxable(productId: string, taxable: boolean): void {
    startTransition(async () => {
      const result = await setNuTechProductTaxable(productId, taxable)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(taxable ? "Marked taxable." : "Marked non-taxable.")
      router.refresh()
    })
  }

  function mapSageCostCode(productId: string, value: string): void {
    startTransition(async () => {
      const result = await mapNuTechProductToSageCostCode(
        productId,
        mappingFromValue(value)
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
      <CatalogSourcePanel workspace={workspace} />
      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Catalog versions</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Imports validate all four price sheets set in Settings against the
              same Airlite cost and SKU list before anything can be activated.
            </p>
          </div>
          {workspace.canImport && (
            <Button onClick={importCatalog} disabled={isPending}>
              <IconDatabaseImport className="size-4" />
              Import catalog
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
                  <SortableTh sortKey="taxable" sort={sort} onSort={toggle} className="px-3 py-2 font-medium">Taxable</SortableTh>
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
                    <PriceCell product={product} cents={product.airliteCostCents} />
                    <PriceCell product={product} cents={product.newStandardPriceCents} />
                    <PriceCell product={product} cents={product.newCashPriceCents} />
                    <PriceCell product={product} cents={product.returningStandardPriceCents} />
                    <PriceCell product={product} cents={product.returningCashPriceCents} />
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
                              (costCode) => `sage:${costCode.id}` === mappingValue(product)
                            ) ||
                            workspace.namedCostCodes.some(
                              (costCode) => `named:${costCode.name}` === mappingValue(product)
                            )
                              ? mappingValue(product)
                              : ""
                          }
                          disabled={isPending}
                          onValueChange={(value) => {
                            if (value !== mappingValue(product)) {
                              mapSageCostCode(product.id, value)
                            }
                          }}
                          options={[
                            { value: "", label: "Not mapped" },
                            ...workspace.sageCostCodes.map((costCode) => ({
                              value: `sage:${costCode.id}`,
                              label: costCode.displayLabel,
                            })),
                            ...workspace.namedCostCodes.map((costCode) => ({
                              value: `named:${costCode.name}`,
                              label: costCode.label,
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
                    <td className="px-3 py-2 align-top">
                      <Checkbox
                        checked={product.taxable}
                        disabled={isPending || !workspace.canImport}
                        aria-label={`${product.name} is taxable`}
                        onCheckedChange={(checked) => setTaxable(product.id, checked === true)}
                      />
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
