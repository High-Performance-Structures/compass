"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import type { ColumnDef } from "@tanstack/react-table"
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
  setNuTechProductBundlesPerTruckload,
  setNuTechProductTaxable,
  type NuTechCatalogWorkspace,
  type NuTechProductCostCodeMapping,
} from "@/app/actions/nutech-catalog"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  NUTECH_2026_CATALOG_SOURCES,
  NUTECH_RESOURCE_LINKS,
} from "@/lib/nutech/resources"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { formatCents, formatDate } from "@/lib/format"

type Product = NuTechCatalogWorkspace["products"][number]
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
    <span className="block text-right">
      {product.quotedPerOrder ? <span className="text-muted-foreground">Quoted</span> : formatCents(cents)}
    </span>
  )
}

function Right({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="block text-right">{children}</span>
}

const productRowId = (product: Product): string => product.id

function productSearchText(product: Product): string {
  return [product.manufacturerSku, product.name, product.packageLabel, product.sageCostCodeLabel].filter(Boolean).join(" ").toLowerCase()
}

type ProductColumnOptions = {
  readonly workspace: NuTechCatalogWorkspace
  readonly isPending: boolean
  readonly onMapSageCostCode: (productId: string, value: string) => void
  readonly onSetBundlesPerTruckload: (product: Product, text: string) => void
  readonly onSetTaxable: (productId: string, taxable: boolean) => void
}

function priceColumn(id: string, header: string, read: (product: Product) => number): ColumnDef<Product> {
  return {
    id,
    accessorFn: read,
    header: () => <Right>{header}</Right>,
    cell: ({ row: { original } }) => <PriceCell product={original} cents={read(original)} />,
  }
}

/** The active product catalog sheet's columns (sheet "nutech.catalog"). */
export function catalogProductColumns({
  workspace,
  isPending,
  onMapSageCostCode,
  onSetBundlesPerTruckload,
  onSetTaxable,
}: ProductColumnOptions): ColumnDef<Product>[] {
  return [
    {
      id: "sku",
      accessorFn: (product) => product.manufacturerSku,
      header: "SKU / product",
      cell: ({ row: { original: product } }) => (
        <>
          <p className="font-medium">{product.manufacturerSku}</p>
          <p className="mt-0.5 text-muted-foreground">{product.name}</p>
        </>
      ),
    },
    {
      id: "package",
      accessorFn: (product) => product.packageLabel,
      header: "Package",
      cell: ({ row: { original: product } }) => (
        <span className="text-muted-foreground">{product.packageLabel} · {product.priceUnit}</span>
      ),
    },
    priceColumn("cost", "Airlite cost", (product) => product.airliteCostCents),
    priceColumn("newStandard", "New standard", (product) => product.newStandardPriceCents),
    priceColumn("newCash", "New cash", (product) => product.newCashPriceCents),
    priceColumn("returning", "Returning", (product) => product.returningStandardPriceCents),
    priceColumn("returningCash", "Returning cash", (product) => product.returningCashPriceCents),
    {
      id: "form",
      accessorFn: (product) => product.airliteTemplateRow,
      header: "Airlite form",
      cell: ({ row: { original: product } }) => (
        <Badge variant={product.airliteMappingStatus === "mapped" ? "secondary" : "outline"}>
          {product.airliteTemplateRow ? `Row ${product.airliteTemplateRow}` : "Addendum"}
        </Badge>
      ),
    },
    {
      id: "costCode",
      accessorFn: (product) => product.sageCostCodeLabel,
      header: "Sage cost code",
      cell: ({ row: { original: product } }) =>
        workspace.canImport ? (
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
                onMapSageCostCode(product.id, value)
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
        ),
    },
    {
      id: "truck",
      accessorFn: (product) => product.bundlesPerTruckload,
      header: () => <Right>Bundles / truck</Right>,
      cell: ({ row: { original: product } }) => (
        <Right>
          {workspace.canImport ? (
            <Input
              key={product.bundlesPerTruckload ?? "unset"}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              defaultValue={product.bundlesPerTruckload ?? ""}
              placeholder="—"
              disabled={isPending}
              aria-label={`Bundles of ${product.manufacturerSku} per truckload`}
              className="ml-auto h-9 w-20 text-right tabular-nums"
              onBlur={(event) => onSetBundlesPerTruckload(product, event.target.value)}
            />
          ) : (
            <span className="tabular-nums text-muted-foreground">{product.bundlesPerTruckload ?? "—"}</span>
          )}
        </Right>
      ),
    },
    {
      id: "taxable",
      accessorFn: (product) => (product.taxable ? 1 : 0),
      header: "Taxable",
      cell: ({ row: { original: product } }) => (
        <Checkbox
          checked={product.taxable}
          disabled={isPending || !workspace.canImport}
          aria-label={`${product.name} is taxable`}
          onCheckedChange={(checked) => onSetTaxable(product.id, checked === true)}
        />
      ),
    },
  ]
}

function sheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

// The four sheets "Import 2026 catalog" reads, in the order staff think of
// them. Kept next to the import source so the links can't drift from it.
const PRICE_SHEETS: readonly { readonly label: string; readonly id: string }[] = [
  { label: "New client – standard", id: NUTECH_2026_CATALOG_SOURCES.newStandardSheetId },
  { label: "New client – cash", id: NUTECH_2026_CATALOG_SOURCES.newCashSheetId },
  { label: "Returning customer – standard", id: NUTECH_2026_CATALOG_SOURCES.returningStandardSheetId },
  { label: "Returning customer – cash", id: NUTECH_2026_CATALOG_SOURCES.returningCashSheetId },
]

const SOURCE_TAB = NUTECH_2026_CATALOG_SOURCES.sourceRange.split("!")[0]?.replaceAll("'", "") ?? ""

/** Where the active prices come from, and how staff update them. */
function CatalogSourcePanel({
  workspace,
}: {
  readonly workspace: NuTechCatalogWorkspace
}): React.ReactElement {
  const active = workspace.versions.find((version) => version.id === workspace.activeVersionId)
  return (
    <section aria-labelledby="nutech-price-source" className="rounded-lg border bg-background p-4">
      <h2 id="nutech-price-source" className="text-sm font-semibold">
        Where these prices come from
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {active
          ? `In use: ${active.name}, effective ${active.effectiveDate}, imported ${formatDate(active.importedAt)}${active.activatedAt ? ` and activated ${formatDate(active.activatedAt)}` : ""}.`
          : "No catalog version is active yet."}{" "}
        Prices are read from the “{SOURCE_TAB}” tab of these Google Sheets, with costs and SKUs from the{" "}
        <a className="underline underline-offset-2" href={NUTECH_RESOURCE_LINKS.airliteOrderForm} target="_blank" rel="noreferrer">
          Airlite order form
        </a>
        :
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {PRICE_SHEETS.map((sheet) => (
          <li key={sheet.id}>
            <a className="underline underline-offset-2" href={sheetUrl(sheet.id)} target="_blank" rel="noreferrer">
              {sheet.label}
            </a>
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
          Change the prices on the “{SOURCE_TAB}” tab of the sheet(s) above. Keep the column
          layout, and keep the same SKUs in all four sheets and the Airlite order form.
        </li>
        <li>
          Here, select <span className="font-medium text-foreground">Import 2026 catalog</span>.
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
        Moving to a new year’s price sheets (new files) needs a Compass update; ask the Compass admin.
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
  const [search, setSearch] = React.useState("")

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

  function setBundlesPerTruckload(product: Product, text: string): void {
    const value = text.trim() === "" ? null : Number(text)
    if (value === product.bundlesPerTruckload) return
    startTransition(async () => {
      const result = await setNuTechProductBundlesPerTruckload(product.id, value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(value === null ? `Cleared the truckload size for ${product.manufacturerSku}.` : `${product.manufacturerSku}: ${value} bundles per truckload.`)
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

  const products = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? workspace.products.filter((product) => productSearchText(product).includes(query)) : workspace.products
  }, [workspace.products, search])
  const columns = React.useMemo(
    () => catalogProductColumns({
      workspace,
      isPending,
      onMapSageCostCode: mapSageCostCode,
      onSetBundlesPerTruckload: setBundlesPerTruckload,
      onSetTaxable: setTaxable,
    }),
    // The handlers only start transitions and refresh; they read nothing that changes between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, isPending],
  )
  const table = useRecordTable({
    data: products,
    columns,
    getRowId: productRowId,
    resetKey: search,
    sheetId: "nutech.catalog",
  })

  return (
    <div className="space-y-6">
      <CatalogSourcePanel workspace={workspace} />
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
          <div className="flex min-w-0 flex-col gap-3 py-3">
            <RecordSearchInput
              value={search}
              onChange={setSearch}
              label="Search Nu-Tech products"
              placeholder="Search SKU, product, package or cost code…"
              className="px-4 sm:max-w-md"
            />
            <RecordTable table={table} itemLabel="products" emptyMessage="No products match this search." rowIdPrefix="nutech-product" />
          </div>
        )}
      </section>
    </div>
  )
}
