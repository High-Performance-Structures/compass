"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  IconCalculator,
  IconCheck,
  IconExternalLink,
  IconFileInvoice,
  IconFileSpreadsheet,
  IconPlus,
  IconSend,
  IconShoppingCart,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectNuTechOrder,
  releaseNuTechAirlitePurchaseOrder,
  releaseNuTechVendorInvoice,
  saveProjectNuTechOrder,
  type ProjectNuTechOrderWorkspace,
} from "@/app/actions/nutech-orders"
import {
  deleteNuTechOrderItem,
  generateNuTechAirliteWorkbook,
  saveNuTechOrderItem,
} from "@/app/actions/nutech-order-items"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NUTECH_RESOURCE_LINKS, nuTechPricingFolderUrl } from "@/lib/nutech/resources"
import { nuTechCustomerPriceCents } from "@/lib/nutech/catalog-pricing"
import {
  NUTECH_CUSTOMER_TYPE_OPTIONS,
  NUTECH_DELIVERY_METHOD_OPTIONS,
  NUTECH_ORDER_STATUS_OPTIONS,
  NUTECH_PRICING_MODE_OPTIONS,
  NUTECH_QUANTITY_SOURCE_OPTIONS,
  NUTECH_SCOPE_TYPE_OPTIONS,
  NUTECH_TAKEOFF_STATUS_OPTIONS,
  NUTECH_VENDOR_INVOICE_STATUS_OPTIONS,
  nuTechOrderStatusLabel,
  nuTechPurchaseOrderReleaseReadiness,
  type NuTechCustomerType,
  type NuTechPricingMode,
  type NuTechQuantitySource,
  type NuTechTakeoffAcknowledgementStatus,
} from "@/lib/nutech/workflow"

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function optionalFormText(formData: FormData, name: string): string | null {
  const value = formText(formData, name).trim()
  return value.length > 0 ? value : null
}

function customerTypeValue(value: string): NuTechCustomerType {
  return value === "returning" ? "returning" : "new"
}

function quantitySourceValue(value: string): NuTechQuantitySource {
  return value === "staff_takeoff" ? "staff_takeoff" : "customer_provided"
}

function takeoffStatusValue(value: string): NuTechTakeoffAcknowledgementStatus {
  if (value === "sent" || value === "signed" || value === "not_required") {
    return value
  }
  return "pending"
}

function money(value: number | null): string {
  if (value === null) return "Amount TBD"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value)
}

function formatDateTime(value: string | null): string {
  if (value === null) return "Not recorded"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function NuTechOrderWorkspace({
  workspace,
}: {
  readonly workspace: ProjectNuTechOrderWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const order = workspace.order
  const [customerType, setCustomerType] = useState<NuTechCustomerType>(
    order?.customerType ?? "new"
  )
  const [quantitySource, setQuantitySource] = useState<NuTechQuantitySource>(
    order?.quantitySource ?? "customer_provided"
  )
  const [pricingMode, setPricingMode] = useState<NuTechPricingMode>(
    order?.pricingMode ?? "standard"
  )
  const [selectedProductId, setSelectedProductId] = useState(
    workspace.catalogProducts[0]?.id ?? ""
  )
  const [itemQuantity, setItemQuantity] = useState("")
  const [takeoffStatus, setTakeoffStatus] =
    useState<NuTechTakeoffAcknowledgementStatus>(
      order?.takeoffAcknowledgementStatus ?? "not_required"
    )
  const pricingFolderUrl = nuTechPricingFolderUrl(customerType)
  const releaseReadiness = nuTechPurchaseOrderReleaseReadiness({
    customerType: order?.customerType ?? null,
    pricingMode: order?.pricingMode ?? null,
    quantitySource: order?.quantitySource ?? null,
    takeoffAcknowledgementStatus:
      order?.takeoffAcknowledgementStatus ?? "not_required",
    airlitePurchaseOrderOperationId:
      order?.airlitePurchaseOrderOperationId ?? null,
    orderItemCount: workspace.orderItems.length,
    airliteWorkbookStatus: order?.airliteWorkbookStatus ?? "not_generated",
  })
  const selectedProduct = workspace.catalogProducts.find(
    (product) => product.id === selectedProductId
  )
  const customerTotalCents = workspace.orderItems.reduce(
    (total, item) => total + item.quantity * item.unitPriceCents,
    0
  )
  const airliteTotalCents = workspace.orderItems.reduce(
    (total, item) => total + item.quantity * item.unitCostCents,
    0
  )
  const pricingBasisChanged =
    order !== null &&
    (customerType !== order.customerType || pricingMode !== order.pricingMode)
  const purchaseOrderReleased =
    order !== null && order.purchaseOrderReleasedAt !== null
  const vendorInvoiceReleased =
    order !== null && order.vendorInvoiceReleasedAt !== null
  const availableOrderStatusOptions = NUTECH_ORDER_STATUS_OPTIONS.filter(
    (option) => {
      if (vendorInvoiceReleased) {
        return ["invoice_released", "complete", "cancelled"].includes(
          option.value
        )
      }
      if (purchaseOrderReleased) {
        return [
          "po_released",
          "vendor_confirmed",
          "invoice_received",
          "complete",
          "cancelled",
        ].includes(option.value)
      }
      return ![
        "po_released",
        "vendor_confirmed",
        "invoice_received",
        "invoice_released",
      ].includes(option.value)
    }
  )
  const availableVendorInvoiceStatusOptions =
    NUTECH_VENDOR_INVOICE_STATUS_OPTIONS.filter(
      (option) =>
        vendorInvoiceReleased ||
        (option.value !== "released" && option.value !== "posted")
    )

  function onQuantitySourceChange(value: string): void {
    const nextSource = quantitySourceValue(value)
    setQuantitySource(nextSource)
    if (nextSource === "customer_provided") {
      setTakeoffStatus("not_required")
    } else if (takeoffStatus === "not_required") {
      setTakeoffStatus("pending")
    }
  }

  function submitOrder(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveProjectNuTechOrder(workspace.projectId, {
        customerType: formText(formData, "customerType"),
        pricingMode: formText(formData, "pricingMode"),
        quantitySource: formText(formData, "quantitySource"),
        takeoffAcknowledgementStatus: formText(
          formData,
          "takeoffAcknowledgementStatus"
        ),
        scopeType: formText(formData, "scopeType"),
        blockQuantityNotes: optionalFormText(formData, "blockQuantityNotes"),
        bracingIncluded: formData.get("bracingIncluded") === "on",
        bracingRentalStartDate: optionalFormText(
          formData,
          "bracingRentalStartDate"
        ),
        bracingRentalEndDate: optionalFormText(
          formData,
          "bracingRentalEndDate"
        ),
        bracingNotes: optionalFormText(formData, "bracingNotes"),
        deliveryMethod: formText(formData, "deliveryMethod"),
        requestedDeliveryDate: optionalFormText(
          formData,
          "requestedDeliveryDate"
        ),
        airlitePurchaseOrderOperationId: optionalFormText(
          formData,
          "airlitePurchaseOrderOperationId"
        ),
        orderStatus: formText(formData, "orderStatus"),
        vendorConfirmationNumber: optionalFormText(
          formData,
          "vendorConfirmationNumber"
        ),
        vendorInvoiceNumber: optionalFormText(formData, "vendorInvoiceNumber"),
        vendorInvoiceStatus: formText(formData, "vendorInvoiceStatus"),
        vendorInvoiceReceivedAt: optionalFormText(
          formData,
          "vendorInvoiceReceivedAt"
        ),
        notes: optionalFormText(formData, "notes"),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(order ? "Nu-Tech order updated." : "Nu-Tech order started.")
      router.refresh()
    })
  }

  function releasePurchaseOrder(): void {
    startTransition(async () => {
      const result = await releaseNuTechAirlitePurchaseOrder(workspace.projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Airlite PO release recorded.")
      router.refresh()
    })
  }

  function saveOrderItem(): void {
    const quantity = Number(itemQuantity)
    if (!selectedProductId || !Number.isInteger(quantity) || quantity <= 0) {
      toast.error("Choose a product and enter a positive whole-number quantity.")
      return
    }
    startTransition(async () => {
      const result = await saveNuTechOrderItem(workspace.projectId, {
        productId: selectedProductId,
        quantity,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setItemQuantity("")
      toast.success("Nu-Tech catalog item saved.")
      router.refresh()
    })
  }

  function removeOrderItem(itemId: string): void {
    startTransition(async () => {
      const result = await deleteNuTechOrderItem(workspace.projectId, itemId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech order item removed.")
      router.refresh()
    })
  }

  function generateAirliteWorkbook(): void {
    startTransition(async () => {
      const result = await generateNuTechAirliteWorkbook(workspace.projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Airlite workbook generated in the project Drive folder.")
      router.refresh()
    })
  }

  function releaseVendorInvoice(): void {
    startTransition(async () => {
      const result = await releaseNuTechVendorInvoice(workspace.projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Airlite vendor invoice released.")
      router.refresh()
    })
  }

  function deleteWorkflow(): void {
    if (
      !window.confirm(
        "Delete this Nu-Tech workflow record? The linked estimate and purchase order will remain in Compass."
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await deleteProjectNuTechOrder(workspace.projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech workflow record deleted.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section className="border-y py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Current handoff</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order
                ? `${nuTechOrderStatusLabel(order.orderStatus)} · updated ${formatDateTime(order.updatedAt)}`
                : "No Nu-Tech order workflow has been started for this project."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {quantitySource === "staff_takeoff"
                ? "Staff takeoff"
                : "Customer quantities"}
            </Badge>
            <Badge variant="outline">
              {takeoffStatus === "not_required"
                ? "Acknowledgement not required"
                : `Acknowledgement: ${takeoffStatus}`}
            </Badge>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <a
          href={pricingFolderUrl ?? NUTECH_RESOURCE_LINKS.newClientPricing}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">2026 customer pricing</p>
            <IconExternalLink className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {customerType === "new" ? "New Client" : "Returning Customer"}
            {" folder · standard and cash-discount sheets."}
          </p>
        </a>
        <a
          href={NUTECH_RESOURCE_LINKS.airliteOrderForm}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">2026 Airlite order form</p>
            <IconExternalLink className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manufacturer-required Fox Blocks purchase-order document.
          </p>
        </a>
        <Link
          href={`/dashboard/projects/${workspace.projectId}/estimate`}
          className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Compass estimate</p>
            <IconCalculator className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.estimate
              ? `${workspace.estimate.number} · ${workspace.estimate.status} · ${money(workspace.estimate.totalCents / 100)}`
              : "Start the client estimate and takeoff acknowledgement here."}
          </p>
        </Link>
      </section>

      <form onSubmit={submitOrder} className="space-y-6">
        <fieldset disabled={!workspace.canEdit || isPending} className="space-y-6">
          <section className="space-y-4 rounded-lg border bg-background p-4">
            <div>
              <h2 className="font-semibold">1. Intake and pricing basis</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the matching published price sheet and record who supplied
                the quantities.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="nutech-customer-type">Customer type</Label>
                <select
                  id="nutech-customer-type"
                  name="customerType"
                  className={SELECT_CLASS}
                  value={customerType}
                  onChange={(event) =>
                    setCustomerType(customerTypeValue(event.target.value))
                  }
                >
                  {NUTECH_CUSTOMER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-pricing-mode">Pricing</Label>
                <select
                  id="nutech-pricing-mode"
                  name="pricingMode"
                  className={SELECT_CLASS}
                  value={pricingMode}
                  onChange={(event) =>
                    setPricingMode(
                      event.target.value === "cash_discount"
                        ? "cash_discount"
                        : "standard"
                    )
                  }
                >
                  {NUTECH_PRICING_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Cash discount means cash, wire, or check.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-quantity-source">Quantity source</Label>
                <select
                  id="nutech-quantity-source"
                  name="quantitySource"
                  className={SELECT_CLASS}
                  value={quantitySource}
                  onChange={(event) => onQuantitySourceChange(event.target.value)}
                >
                  {NUTECH_QUANTITY_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-takeoff-status">
                  Takeoff acknowledgement
                </Label>
                <select
                  id="nutech-takeoff-status"
                  name="takeoffAcknowledgementStatus"
                  className={SELECT_CLASS}
                  value={takeoffStatus}
                  disabled={quantitySource === "customer_provided"}
                  onChange={(event) =>
                    setTakeoffStatus(takeoffStatusValue(event.target.value))
                  }
                >
                  {NUTECH_TAKEOFF_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {quantitySource === "customer_provided" && (
                  <input
                    type="hidden"
                    name="takeoffAcknowledgementStatus"
                    value="not_required"
                  />
                )}
              </div>
            </div>
            <Alert>
              <IconCheck className="size-4" />
              <AlertTitle>
                {quantitySource === "customer_provided"
                  ? "No acknowledgement required"
                  : "Signed acknowledgement required before PO release"}
              </AlertTitle>
              <AlertDescription>
                {quantitySource === "customer_provided"
                  ? "The customer supplied the order quantities, so Compass will not hold the Airlite PO for a takeoff acknowledgement."
                  : "Attach the Nu-Tech takeoff acknowledgement to the client estimate and record it as signed before releasing the Airlite PO."}
              </AlertDescription>
            </Alert>
          </section>

          <section className="space-y-4 rounded-lg border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">2. Product quantities</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workspace.catalogVersionName
                    ? `${workspace.catalogVersionName} · package increments are enforced automatically.`
                    : "Import and activate the 2026 product catalog before entering quantities."}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/nutech/catalog">Product catalog</Link>
              </Button>
            </div>
            {workspace.catalogProducts.length > 0 && (
              <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_9rem_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="nutech-product">Catalog product</Label>
                  <select
                    id="nutech-product"
                    className={SELECT_CLASS}
                    value={selectedProductId}
                    onChange={(event) => setSelectedProductId(event.target.value)}
                  >
                    {workspace.catalogProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.manufacturerSku} · {product.name} · {money(
                          nuTechCustomerPriceCents(
                            product,
                            customerType,
                            pricingMode
                          ) / 100
                        )}/{product.priceUnit}
                      </option>
                    ))}
                  </select>
                  {selectedProduct && (
                    <p className="text-xs text-muted-foreground">
                      Order in multiples of {selectedProduct.minimumOrderIncrement} · {selectedProduct.packageLabel}
                      {selectedProduct.airliteMappingStatus === "mapped"
                        ? " · Airlite form row mapped"
                        : " · included in the Airlite addendum"}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-product-quantity">Quantity</Label>
                  <Input
                    id="nutech-product-quantity"
                    type="number"
                    min={selectedProduct?.minimumOrderIncrement ?? 1}
                    step={selectedProduct?.minimumOrderIncrement ?? 1}
                    value={itemQuantity}
                    onChange={(event) => setItemQuantity(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  disabled={
                    !order ||
                    !selectedProduct ||
                    isPending ||
                    pricingBasisChanged ||
                    purchaseOrderReleased
                  }
                  onClick={saveOrderItem}
                >
                  <IconPlus className="size-4" />
                  Add / update
                </Button>
              </div>
            )}
            {!order && workspace.catalogProducts.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Save the intake once before adding catalog quantities.
              </p>
            )}
            {pricingBasisChanged && (
              <p className="text-sm text-muted-foreground">
                Save the revised customer/pricing basis before adding or updating
                products. Existing line prices will refresh when the workflow is saved.
              </p>
            )}
            {workspace.orderItems.length > 0 && (
              <div className="overflow-x-auto border-y">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 font-medium">Product</th>
                      <th className="px-2 py-2 text-right font-medium">Quantity</th>
                      <th className="px-2 py-2 text-right font-medium">Unit price</th>
                      <th className="px-2 py-2 text-right font-medium">Customer total</th>
                      <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {workspace.orderItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-2 py-2">
                          <p className="font-medium">{item.manufacturerSku}</p>
                          <p className="text-xs text-muted-foreground">{item.name}</p>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {item.quantity} {item.priceUnit}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {money(item.unitPriceCents / 100)}
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          {money((item.quantity * item.unitPriceCents) / 100)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={isPending || purchaseOrderReleased}
                            onClick={() => removeOrderItem(item.id)}
                          >
                            <IconTrash className="size-4" />
                            <span className="sr-only">Remove {item.manufacturerSku}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t">
                    <tr>
                      <td colSpan={3} className="px-2 py-2 text-right text-muted-foreground">
                        Airlite cost {money(airliteTotalCents / 100)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {money(customerTotalCents / 100)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-background p-4">
            <div>
              <h2 className="font-semibold">3. Bracing and delivery</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Bracing rental rates remain on the applicable 2026 Fox Blocks price
                sheet.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="nutech-scope">Order scope</Label>
                <select
                  id="nutech-scope"
                  name="scopeType"
                  className={SELECT_CLASS}
                  defaultValue={order?.scopeType ?? "block_sale"}
                >
                  {NUTECH_SCOPE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-delivery-method">Fulfillment</Label>
                <select
                  id="nutech-delivery-method"
                  name="deliveryMethod"
                  className={SELECT_CLASS}
                  defaultValue={order?.deliveryMethod ?? "delivery"}
                >
                  {NUTECH_DELIVERY_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-requested-delivery">
                  Requested delivery / pickup
                </Label>
                <Input
                  id="nutech-requested-delivery"
                  name="requestedDeliveryDate"
                  type="date"
                  defaultValue={order?.requestedDeliveryDate ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-status">Workflow status</Label>
                <select
                  id="nutech-status"
                  name="orderStatus"
                  className={SELECT_CLASS}
                  defaultValue={order?.orderStatus ?? "intake"}
                >
                  {availableOrderStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nutech-block-notes">
                  Block quantities and accessory notes
                </Label>
                <Textarea
                  id="nutech-block-notes"
                  name="blockQuantityNotes"
                  rows={5}
                  defaultValue={order?.blockQuantityNotes ?? ""}
                  placeholder="Fox Block sizes, Web Boxes, accessories, bundle quantities, waste, and takeoff notes"
                />
              </div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nutech-bracing-start">Bracing start</Label>
                    <Input
                      id="nutech-bracing-start"
                      name="bracingRentalStartDate"
                      type="date"
                      defaultValue={order?.bracingRentalStartDate ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nutech-bracing-end">Bracing return due</Label>
                    <Input
                      id="nutech-bracing-end"
                      name="bracingRentalEndDate"
                      type="date"
                      defaultValue={order?.bracingRentalEndDate ?? ""}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-bracing-notes">Bracing rental notes</Label>
                  <Textarea
                    id="nutech-bracing-notes"
                    name="bracingNotes"
                    rows={3}
                    defaultValue={order?.bracingNotes ?? ""}
                    placeholder="Sets, pickup or delivery, condition, extensions, and return coordination"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">4. Airlite PO and vendor invoice</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Link the Compass PO, then release it after the applicable intake
                  gates are complete.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${workspace.projectId}/purchase-orders`}>
                  <IconShoppingCart className="size-4" />
                  Open purchase orders
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nutech-airlite-po">Linked Airlite PO</Label>
                <select
                  id="nutech-airlite-po"
                  name="airlitePurchaseOrderOperationId"
                  className={SELECT_CLASS}
                  defaultValue={order?.airlitePurchaseOrderOperationId ?? ""}
                >
                  <option value="">Choose a Compass purchase order</option>
                  {workspace.purchaseOrders.map((purchaseOrder) => (
                    <option key={purchaseOrder.id} value={purchaseOrder.id}>
                      {purchaseOrder.number ?? "Unnumbered"} · {purchaseOrder.title}
                      {purchaseOrder.companyName
                        ? ` · ${purchaseOrder.companyName}`
                        : ""}
                      {` · ${money(purchaseOrder.amount)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-vendor-confirmation">
                  Airlite confirmation
                </Label>
                <Input
                  id="nutech-vendor-confirmation"
                  name="vendorConfirmationNumber"
                  defaultValue={order?.vendorConfirmationNumber ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label>PO release recorded</Label>
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  {formatDateTime(order?.purchaseOrderReleasedAt ?? null)}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-invoice-number">Vendor invoice number</Label>
                <Input
                  id="nutech-invoice-number"
                  name="vendorInvoiceNumber"
                  defaultValue={order?.vendorInvoiceNumber ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-invoice-status">Invoice status</Label>
                <select
                  id="nutech-invoice-status"
                  name="vendorInvoiceStatus"
                  className={SELECT_CLASS}
                  defaultValue={order?.vendorInvoiceStatus ?? "not_received"}
                >
                  {availableVendorInvoiceStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-invoice-received">Invoice received</Label>
                <Input
                  id="nutech-invoice-received"
                  name="vendorInvoiceReceivedAt"
                  type="date"
                  defaultValue={order?.vendorInvoiceReceivedAt ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice release recorded</Label>
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  {formatDateTime(order?.vendorInvoiceReleasedAt ?? null)}
                </p>
              </div>
            </div>
            {order && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">Airlite workbook</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.airliteWorkbookStatus === "stale"
                      ? "Order quantities changed; generate a fresh workbook before release."
                      : order.airliteWorkbookGeneratedAt
                        ? `${order.airliteWorkbookStatus.replaceAll("_", " ")} · ${formatDateTime(order.airliteWorkbookGeneratedAt)}`
                        : "Not generated"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {order.airliteWorkbookUrl && (
                    <Button asChild type="button" variant="outline" size="sm">
                      <a href={order.airliteWorkbookUrl} target="_blank" rel="noreferrer">
                        <IconExternalLink className="size-4" />
                        Open latest workbook
                      </a>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      isPending ||
                      workspace.orderItems.length === 0 ||
                      !order.airlitePurchaseOrderOperationId ||
                      purchaseOrderReleased
                    }
                    onClick={generateAirliteWorkbook}
                  >
                    <IconFileSpreadsheet className="size-4" />
                    Generate workbook
                  </Button>
                </div>
              </div>
            )}
            {order && !releaseReadiness.ready && (
              <Alert>
                <AlertTitle>PO release checklist</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {releaseReadiness.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </section>

          <section className="space-y-2 rounded-lg border bg-background p-4">
            <Label htmlFor="nutech-notes">Internal order notes</Label>
            <Textarea
              id="nutech-notes"
              name="notes"
              rows={4}
              defaultValue={order?.notes ?? ""}
              placeholder="Customer communications, takeoff help, availability, freight, and follow-up notes"
            />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isPending}>
                <IconCheck className="size-4" />
                {order ? "Save workflow" : "Start Nu-Tech order"}
              </Button>
              {order && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    isPending ||
                    !releaseReadiness.ready ||
                    purchaseOrderReleased
                  }
                  onClick={releasePurchaseOrder}
                >
                  <IconSend className="size-4" />
                  Record Airlite PO release
                </Button>
              )}
              {order && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending || vendorInvoiceReleased}
                  onClick={releaseVendorInvoice}
                >
                  <IconFileInvoice className="size-4" />
                  Release vendor invoice
                </Button>
              )}
            </div>
            {order && workspace.canDelete && !purchaseOrderReleased && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={isPending}
                onClick={deleteWorkflow}
              >
                <IconTrash className="size-4" />
                Delete workflow record
              </Button>
            )}
          </div>
        </fieldset>
        {!workspace.canEdit && (
          <p className="text-sm text-muted-foreground">
            You have read-only access to this Nu-Tech workflow.
          </p>
        )}
      </form>
    </div>
  )
}
