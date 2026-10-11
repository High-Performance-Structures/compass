"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { SearchableCombobox, SearchableComboboxField } from "@/components/searchable-combobox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { DOCUMENT_INPUT_CLASS, DOCUMENT_SELECT_TRIGGER_CLASS, DOCUMENT_TEXTAREA_CLASS } from "@/lib/ui/document-fields"
import { cn } from "@/lib/utils"
import { NuTechManufacturerPoButton } from "@/components/nutech/nutech-manufacturer-po-button"
import { NuTechEstimateButton } from "@/components/nutech/nutech-estimate-button"
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
  NUTECH_PAYMENT_METHOD_OPTIONS,
  NUTECH_SCOPE_TYPE_OPTIONS,
  NUTECH_TAKEOFF_STATUS_OPTIONS,
  NUTECH_VENDOR_INVOICE_STATUS_OPTIONS,
  nuTechOrderStatusLabel,
  nuTechCustomerReadinessIssues,
  nuTechPurchaseOrderReleaseReadiness,
  type NuTechCustomerType,
  type NuTechPricingMode,
  type NuTechQuantitySource,
  type NuTechTakeoffAcknowledgementStatus,
} from "@/lib/nutech/workflow"

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
  manufacturerName = "",
}: {
  readonly workspace: ProjectNuTechOrderWorkspace
  /** From Settings → Workflows → Nu-Tech emails; labels the PO button. */
  readonly manufacturerName?: string
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
    customerReadinessIssues: nuTechCustomerReadinessIssues({
      deliveryMethod: order?.deliveryMethod ?? "delivery",
      customerPaidAt: order?.customerPaidAt ?? null,
      requestedDeliveryDate: order?.requestedDeliveryDate ?? null,
      trailerDimensions: order?.trailerDimensions ?? null,
      trailerPhotoReceivedAt: order?.trailerPhotoReceivedAt ?? null,
    }),
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

  const formRef = useRef<HTMLFormElement | null>(null)
  const [fulfillment, setFulfillment] = useState<string>(order?.deliveryMethod ?? "delivery")
  const [shipping, setShipping] = useState(order?.shippingCents != null ? (order.shippingCents / 100).toFixed(2) : "")
  const [taxEntityId, setTaxEntityId] = useState(order?.taxEntityId ?? "")
  const isDelivery = fulfillment === "delivery"
  // Pickups are taxed at the warehouse unless someone picked a district.
  const effectiveTaxEntityId = taxEntityId || (isDelivery ? "" : (workspace.warehouseTaxEntityId ?? ""))
  const taxDistrict = workspace.taxDistricts.find((district) => district.id === effectiveTaxEntityId) ?? null
  const shippingCents = isDelivery ? Math.max(0, Math.round((Number.parseFloat(shipping.replace(/[$,]/g, "")) || 0) * 100)) : 0
  // Items are taxed per their price-list setting (old catalog rows default to taxable); shipping per Freight's.
  const taxableCents =
    workspace.orderItems.reduce(
      (total, item) =>
        workspace.catalogProducts.find((product) => product.id === item.productId)?.taxable === false
          ? total
          : total + item.quantity * item.unitPriceCents,
      0
    ) + (workspace.shippingTaxable ? shippingCents : 0)
  const taxCents = taxDistrict ? Math.round((taxableCents * taxDistrict.rateBasisPoints) / 10_000) : 0

  function orderInput(formData: FormData): Parameters<typeof saveProjectNuTechOrder>[1] {
    return {
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
      customerPaidAt: optionalFormText(formData, "customerPaidAt"),
      customerPaymentMethod: optionalFormText(formData, "customerPaymentMethod"),
      trailerDimensions: optionalFormText(formData, "trailerDimensions"),
      trailerPhotoReceivedAt: optionalFormText(formData, "trailerPhotoReceivedAt"),
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
      shippingCents: isDelivery && shipping.trim() !== "" ? shippingCents : null,
      shippingNote: optionalFormText(formData, "shippingNote"),
      taxEntityId: optionalFormText(formData, "taxEntityId"),
      notes: optionalFormText(formData, "notes"),
    }
  }

  function submitOrder(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveProjectNuTechOrder(workspace.projectId, orderInput(formData))
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(order ? "Nu-Tech order saved." : "Nu-Tech order started.")
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
      // The first product starts the order (and a changed pricing basis is
      // saved) from the intake above, so there is no separate save step.
      if (!order || pricingBasisChanged) {
        const form = formRef.current
        if (!form) return
        const saved = await saveProjectNuTechOrder(workspace.projectId, orderInput(new FormData(form)))
        if (!saved.success) {
          toast.error(saved.error)
          return
        }
      }
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
    <div className="max-w-5xl space-y-8">
      <section className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Current handoff</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order
                ? `${nuTechOrderStatusLabel(order.orderStatus)} · updated ${formatDateTime(order.updatedAt)}`
                : "No Nu-Tech order workflow has been started for this project."}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {quantitySource === "staff_takeoff" ? "Staff takeoff" : "Customer quantities"}
            {" · "}
            {takeoffStatus === "not_required" ? "Acknowledgement not required" : `Acknowledgement ${takeoffStatus}`}
          </p>
        </div>
      </section>

      <section aria-label="Resources" className="grid border-b md:grid-cols-3 md:divide-x">
        <a
          href={pricingFolderUrl ?? NUTECH_RESOURCE_LINKS.newClientPricing}
          target="_blank"
          rel="noreferrer"
          className="block py-3 transition-colors hover:bg-accent md:px-4 md:first:pl-0"
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
          className="block py-3 transition-colors hover:bg-accent md:px-4 md:first:pl-0"
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
          className="block py-3 transition-colors hover:bg-accent md:px-4 md:first:pl-0"
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

      <form ref={formRef} onSubmit={submitOrder} className="space-y-8">
        <fieldset disabled={!workspace.canEdit || isPending} className="space-y-6">
          <section id="nutech-intake" className="scroll-mt-4 space-y-5 border-b pb-8">
            <div>
              <h2 className="text-base font-semibold">1. Intake and pricing basis</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the matching published price sheet and record who supplied
                the quantities.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="nutech-customer-type">Customer type</Label>
                <Select name="customerType"
                  value={customerType}
                  onValueChange={(value) => setCustomerType(customerTypeValue(value))}
                >
                  <SelectTrigger id="nutech-customer-type" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_CUSTOMER_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-pricing-mode">Pricing</Label>
                <Select name="pricingMode"
                  value={pricingMode}
                  onValueChange={(value) =>
                    setPricingMode(
                      value === "cash_discount" ? "cash_discount" : "standard"
                    )
                  }
                >
                  <SelectTrigger id="nutech-pricing-mode" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_PRICING_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Cash discount means cash, wire, or check.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-quantity-source">Quantity source</Label>
                <Select name="quantitySource"
                  value={quantitySource}
                  onValueChange={onQuantitySourceChange}
                >
                  <SelectTrigger id="nutech-quantity-source" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_QUANTITY_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-takeoff-status">
                  Takeoff acknowledgement
                </Label>
                <Select name="takeoffAcknowledgementStatus"
                  value={takeoffStatus}
                  onValueChange={(value) => setTakeoffStatus(takeoffStatusValue(value))}
                  disabled={quantitySource === "customer_provided"}
                >
                  <SelectTrigger id="nutech-takeoff-status" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_TAKEOFF_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quantitySource === "customer_provided" && (
                  <input
                    type="hidden"
                    name="takeoffAcknowledgementStatus"
                    value="not_required"
                  />
                )}
              </div>
            </div>
            <div className="border-l-2 pl-3 text-sm">
              <p className="font-medium">
                {quantitySource === "customer_provided"
                  ? "No acknowledgement required"
                  : "Signed acknowledgement required before PO release"}
              </p>
              <p className="text-muted-foreground">
                {quantitySource === "customer_provided"
                  ? "The customer supplied the order quantities, so Compass will not hold the Airlite PO for a takeoff acknowledgement."
                  : "Attach the Nu-Tech takeoff acknowledgement to the client estimate and record it as signed before releasing the Airlite PO."}
              </p>
            </div>
          </section>

          <section id="nutech-quantities" className="scroll-mt-4 space-y-5 border-b pb-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">2. Product quantities</h2>
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
                  <SearchableCombobox
                    id="nutech-product"
                    className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-9")}
                    value={selectedProductId}
                    onValueChange={(value) => {
                      if (value !== "") setSelectedProductId(value)
                    }}
                    options={workspace.catalogProducts.map((product) => ({
                      value: product.id,
                      label: `${product.manufacturerSku} · ${product.name}`,
                      selectedLabel: `${product.manufacturerSku} · ${product.name} · ${money(
                        nuTechCustomerPriceCents(product, customerType, pricingMode) / 100
                      )}/${product.priceUnit}`,
                      description: `${money(
                        nuTechCustomerPriceCents(product, customerType, pricingMode) / 100
                      )}/${product.priceUnit}`,
                    }))}
                    ariaLabel="Catalog product"
                    placeholder="Choose a product"
                    searchPlaceholder="Search SKU or product..."
                    emptyMessage="No matching products."
                  />
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
                  <Input className={DOCUMENT_INPUT_CLASS}
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
                  disabled={!selectedProduct || isPending || purchaseOrderReleased}
                  onClick={saveOrderItem}
                >
                  <IconPlus className="size-4" />
                  Add / update
                </Button>
              </div>
            )}
            {!order && workspace.catalogProducts.length > 0 && (
              <p className="text-sm text-muted-foreground">Adding the first product starts the order with the intake above.</p>
            )}
            {order && pricingBasisChanged && (
              <p className="text-sm text-muted-foreground">
                The pricing basis changed; adding a product (or saving) refreshes the existing line prices.
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

          <section id="nutech-fulfillment" className="scroll-mt-4 space-y-5 border-b pb-8">
            <div>
              <h2 className="text-base font-semibold">3. Delivery, shipping and tax</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Deliveries add the shipping charge quoted for the order (not taxed). Sales tax follows where the block is delivered, or the warehouse for pickups.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="nutech-scope">Order scope</Label>
                <Select name="scopeType"
                  defaultValue={order?.scopeType ?? "block_sale"}
                >
                  <SelectTrigger id="nutech-scope" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_SCOPE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-delivery-method">Fulfillment</Label>
                <Select name="deliveryMethod" value={fulfillment} onValueChange={setFulfillment}>
                  <SelectTrigger id="nutech-delivery-method" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUTECH_DELIVERY_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-requested-delivery">
                  Requested delivery / pickup
                </Label>
                <Input className={DOCUMENT_INPUT_CLASS}
                  id="nutech-requested-delivery"
                  name="requestedDeliveryDate"
                  type="date"
                  defaultValue={order?.requestedDeliveryDate ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-status">Workflow status</Label>
                <SearchableComboboxField
                  id="nutech-status"
                  name="orderStatus"
                  className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-9")}
                  defaultValue={order?.orderStatus ?? "intake"}
                  options={availableOrderStatusOptions}
                  ariaLabel="Workflow status"
                  placeholder="Choose status"
                  searchPlaceholder="Search statuses..."
                  emptyMessage="No matching statuses."
                />
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Shipping and sales tax</h3>
              <div className="grid gap-4 md:grid-cols-4">
                {isDelivery ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="nutech-shipping">Shipping charge ($)</Label>
                      <Input
                        className={DOCUMENT_INPUT_CLASS}
                        id="nutech-shipping"
                        inputMode="decimal"
                        placeholder="Quoted for this order"
                        value={shipping}
                        onChange={(event) => setShipping(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nutech-shipping-note">Quote from</Label>
                      <Input
                        className={DOCUMENT_INPUT_CLASS}
                        id="nutech-shipping-note"
                        name="shippingNote"
                        placeholder="Who quoted it, and when"
                        defaultValue={order?.shippingNote ?? ""}
                      />
                    </div>
                  </>
                ) : null}
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="nutech-tax-district">
                    {isDelivery ? "Sales tax district (delivery address)" : "Sales tax district (pickup warehouse)"}
                  </Label>
                  <input type="hidden" name="taxEntityId" value={effectiveTaxEntityId} />
                  <SearchableCombobox
                    id="nutech-tax-district"
                    className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-9")}
                    ariaLabel="Sales tax district"
                    placeholder="Choose the district"
                    searchPlaceholder="Search districts..."
                    emptyMessage="No matching district."
                    value={effectiveTaxEntityId}
                    options={workspace.taxDistricts.map((district) => ({
                      value: district.id,
                      label: `${district.name} · ${(district.rateBasisPoints / 100).toFixed(2)}%`,
                      keywords: district.code,
                    }))}
                    onValueChange={(value) => {
                      if (value !== "") setTaxEntityId(value)
                    }}
                  />
                  {!isDelivery && !workspace.warehouseTaxEntityId ? (
                    <p className="text-xs text-muted-foreground">
                      Set the warehouse&apos;s district once in Settings → Workflows → Nu-Tech emails to fill this in for every pickup.
                    </p>
                  ) : null}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Products</dt>
                  <dd className="tabular-nums">{money(customerTotalCents / 100)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Shipping (not taxed)</dt>
                  <dd className="tabular-nums">{isDelivery ? money(shippingCents / 100) : "Pickup"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Sales tax{taxDistrict ? ` (${(taxDistrict.rateBasisPoints / 100).toFixed(2)}%)` : ""}
                  </dt>
                  <dd className="tabular-nums">{taxDistrict ? money(taxCents / 100) : "Choose a district"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Customer total</dt>
                  <dd className="font-semibold tabular-nums">{money((customerTotalCents + shippingCents + taxCents) / 100)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <NuTechEstimateButton projectId={workspace.projectId} disabled={!order || workspace.orderItems.length === 0 || isPending} />
                <span className="text-xs text-muted-foreground">
                  Save the order first; the estimate uses the saved products, shipping and district.
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Customer readiness</h3>
              <p className="text-xs text-muted-foreground">
                Needed before the order goes to the manufacturer: payment and the requested date, and for customer pickup the trailer dimensions and a trailer photo.
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="nutech-paid-at">Customer paid</Label>
                  <Input className={DOCUMENT_INPUT_CLASS} id="nutech-paid-at" name="customerPaidAt" type="date" defaultValue={order?.customerPaidAt ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-payment-method">Payment method</Label>
                  <Select name="customerPaymentMethod" defaultValue={order?.customerPaymentMethod ?? undefined}>
                    <SelectTrigger id="nutech-payment-method" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                      <SelectValue placeholder="Not paid yet" />
                    </SelectTrigger>
                    <SelectContent>
                      {NUTECH_PAYMENT_METHOD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-trailer-dimensions">Trailer dimensions (pickup)</Label>
                  <Input className={DOCUMENT_INPUT_CLASS}
                    id="nutech-trailer-dimensions"
                    name="trailerDimensions"
                    placeholder={`8'6" wide × 26' long, enclosed, swing doors`}
                    defaultValue={order?.trailerDimensions ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-trailer-photo">Trailer photo received (pickup)</Label>
                  <Input className={DOCUMENT_INPUT_CLASS} id="nutech-trailer-photo" name="trailerPhotoReceivedAt" type="date" defaultValue={order?.trailerPhotoReceivedAt ?? ""} />
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nutech-block-notes">
                  Block quantities and accessory notes
                </Label>
                <Textarea className={DOCUMENT_TEXTAREA_CLASS}
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
                    <Input className={DOCUMENT_INPUT_CLASS}
                      id="nutech-bracing-start"
                      name="bracingRentalStartDate"
                      type="date"
                      defaultValue={order?.bracingRentalStartDate ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nutech-bracing-end">Bracing return due</Label>
                    <Input className={DOCUMENT_INPUT_CLASS}
                      id="nutech-bracing-end"
                      name="bracingRentalEndDate"
                      type="date"
                      defaultValue={order?.bracingRentalEndDate ?? ""}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nutech-bracing-notes">Bracing rental notes</Label>
                  <Textarea className={DOCUMENT_TEXTAREA_CLASS}
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

          <section id="nutech-airlite" className="scroll-mt-4 space-y-5 border-b pb-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">4. Airlite PO and vendor invoice</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build the PO from this order (or link an existing one), then
                  release it after the applicable intake gates are complete.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {order?.airlitePurchaseOrderOperationId ? null : (
                  <NuTechManufacturerPoButton projectId={workspace.projectId} manufacturerName={manufacturerName} size="sm" />
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/projects/${workspace.projectId}/purchase-orders`}>
                    <IconShoppingCart className="size-4" />
                    Open purchase orders
                  </Link>
                </Button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nutech-airlite-po">Linked Airlite PO</Label>
                <SearchableComboboxField
                  id="nutech-airlite-po"
                  name="airlitePurchaseOrderOperationId"
                  className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-9")}
                  defaultValue={order?.airlitePurchaseOrderOperationId ?? ""}
                  options={[
                    { value: "", label: "No linked purchase order" },
                    ...workspace.purchaseOrders.map((purchaseOrder) => ({
                      value: purchaseOrder.id,
                      label: `${purchaseOrder.number ?? "Unnumbered"} · ${purchaseOrder.title}`,
                      description: [purchaseOrder.companyName, money(purchaseOrder.amount)]
                        .filter(Boolean)
                        .join(" · "),
                    })),
                  ]}
                  ariaLabel="Linked Airlite PO"
                  placeholder="Choose a Compass purchase order"
                  searchPlaceholder="Search purchase orders..."
                  emptyMessage="No matching purchase orders."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-vendor-confirmation">
                  Airlite confirmation
                </Label>
                <Input className={DOCUMENT_INPUT_CLASS}
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
                <Input className={DOCUMENT_INPUT_CLASS}
                  id="nutech-invoice-number"
                  name="vendorInvoiceNumber"
                  defaultValue={order?.vendorInvoiceNumber ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-invoice-status">Invoice status</Label>
                <Select name="vendorInvoiceStatus"
                  defaultValue={order?.vendorInvoiceStatus ?? "not_received"}
                >
                  <SelectTrigger id="nutech-invoice-status" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVendorInvoiceStatusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nutech-invoice-received">Invoice received</Label>
                <Input className={DOCUMENT_INPUT_CLASS}
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
              <div className="border-l-2 border-warning pl-3 text-sm">
                <p className="font-medium">Before the PO can be released</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {releaseReadiness.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-2 pb-4">
            <Label htmlFor="nutech-notes">Internal order notes</Label>
            <Textarea className={DOCUMENT_TEXTAREA_CLASS}
              id="nutech-notes"
              name="notes"
              rows={4}
              defaultValue={order?.notes ?? ""}
              placeholder="Customer communications, takeoff help, availability, freight, and follow-up notes"
            />
          </section>

          {/* Keeps Save visible while scrolling the long form, like a drawer footer. */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isPending}>
                <IconCheck className="size-4" />
                {order ? "Save order" : "Start order"}
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
