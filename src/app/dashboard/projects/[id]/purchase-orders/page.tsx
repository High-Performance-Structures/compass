import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconExternalLink,
  IconShoppingCart,
} from "@tabler/icons-react"

import {
  getProjectPurchaseOrderFormOptions,
  getProjectPurchaseOrders,
  type ProjectPurchaseOrderItem,
} from "@/app/actions/project-operations"
import {
  getProjectContactsSummary,
  getProjectPurchaseOrderSiteContactOptions,
  getProjectTaskAssigneeOptions,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectPurchaseOrderDeleteButton } from "@/components/projects/project-purchase-order-delete-button"
import { ProjectPurchaseOrderEmailButton } from "@/components/projects/project-purchase-order-email-button"
import {
  ProjectPurchaseOrderCreateForm,
  ProjectPurchaseOrderEditForm,
} from "@/components/projects/project-purchase-order-create-form"
import { ProjectPurchaseOrderPrintButton } from "@/components/projects/project-purchase-order-print-button"
import { ProjectOperationStatusSelect } from "@/components/projects/project-operation-status-select"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"
import { canManageProjectRegistry } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import {
  isClosedProjectOperationStatus,
  parseProjectOperationStatusFilter,
  projectOperationMatchesStatusFilter,
  type ProjectOperationStatusFilter,
} from "@/lib/project-operations/status"
import { canEditPurchaseOrderDraft } from "@/lib/purchase-orders/draft-edit"
import { resolvedPurchaseOrderShipTo } from "@/lib/purchase-orders/ship-to"
import { purchaseOrderSiteContactLabel } from "@/lib/purchase-orders/site-contact"
import {
  buildProjectEmailRecipientOptions,
  type EmailRecipientOption,
} from "@/lib/email/recipient-options"
import {
  projectBrandFor,
  type ProjectBrand,
} from "@/lib/project-branding"

function money(value: number | null): string {
  if (value === null) return "Amount TBD"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

const PURCHASE_ORDER_FILTERS: readonly {
  readonly value: ProjectOperationStatusFilter
  readonly label: string
}[] = [
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "ordered", label: "Ordered" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "complete", label: "Complete" },
  { value: "closed", label: "Closed" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
]

function purchaseOrderTaskTitle(order: ProjectPurchaseOrderItem): string {
  return `Follow up P.O.: ${order.sourceRecordNumber ?? order.title}`
}

function purchaseOrderTaskDescription(order: ProjectPurchaseOrderItem): string {
  const lines = order.lines.map((line) => {
    const amount = money(line.amount)
    return `Line ${line.lineNumber}: ${line.description} (${amount})`
  })

  return [
    order.description ?? order.title,
    "",
    order.companyName ? `Vendor: ${order.companyName}` : null,
    order.sageShipTo ? `Ship to / pickup: ${order.sageShipTo}` : null,
    lines.length > 0 ? "Lines:" : null,
    ...lines,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

function PurchaseOrderCard({
  brand,
  order,
  projectId,
  projectLabel,
  isCreated,
  isFocused,
  taskAssigneeOptions,
  siteContactOptions,
  emailRecipientOptions,
  jobsiteAddress,
  phaseOptions,
  costCodeOptions,
  developerModeEnabled,
}: {
  readonly brand: ProjectBrand
  readonly order: ProjectPurchaseOrderItem
  readonly projectId: string
  readonly projectLabel: string
  readonly isCreated: boolean
  readonly isFocused: boolean
  readonly taskAssigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly siteContactOptions: readonly ProjectTaskAssigneeOption[]
  readonly emailRecipientOptions: readonly EmailRecipientOption[]
  readonly jobsiteAddress: string | null
  readonly phaseOptions: React.ComponentProps<
    typeof ProjectPurchaseOrderEditForm
  >["phaseOptions"]
  readonly costCodeOptions: React.ComponentProps<
    typeof ProjectPurchaseOrderEditForm
  >["costCodeOptions"]
  readonly developerModeEnabled: boolean
}): React.ReactElement {
  const deliveryLocation = resolvedPurchaseOrderShipTo({
    storedShipTo: order.sageShipTo,
    jobsiteAddress,
  })

  return (
    <article
      id={`purchase-order-${order.id}`}
      data-po-id={order.id}
      className={cn(
        "po-printable scroll-mt-6 rounded-lg border bg-background p-4 print:border-0 print:p-0",
        (isCreated || isFocused) && "border-brand-hps-primary bg-card"
      )}
    >
      <div className="print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {order.sourceRecordNumber ?? "Unnumbered"}
            </p>
            <h2 className="mt-1 text-base font-semibold">{order.title}</h2>
          </div>
          <div className="flex flex-wrap gap-1">
            {isCreated && <Badge variant="secondary">Just created</Badge>}
            {isFocused && !isCreated && (
              <Badge variant="secondary">Selected from calendar</Badge>
            )}
            <ProjectOperationStatusSelect
              projectId={projectId}
              operationId={order.id}
              operationKind="purchase_order"
              status={order.status}
            />
            {developerModeEnabled && (
              <Badge variant="outline">{label(order.syncStatus)}</Badge>
            )}
            {order.priority === "high" && (
              <Badge variant="destructive">High</Badge>
            )}
            {canEditPurchaseOrderDraft(order) && (
              <ProjectPurchaseOrderEditForm
                projectId={projectId}
                purchaseOrder={order}
                contactOptions={taskAssigneeOptions}
                siteContactOptions={siteContactOptions}
                jobsiteAddress={jobsiteAddress}
                phaseOptions={phaseOptions}
                costCodeOptions={costCodeOptions}
              />
            )}
            <ProjectPurchaseOrderEmailButton
              projectId={projectId}
              purchaseOrderId={order.id}
              poNumber={order.sourceRecordNumber}
              projectLabel={projectLabel}
              supplierName={order.companyName}
              supplierEmail={order.vendorEmail}
              recipientOptions={emailRecipientOptions}
            />
            <ProjectPurchaseOrderDeleteButton
              poNumber={order.sourceRecordNumber}
              projectId={projectId}
              purchaseOrderId={order.id}
              title={order.title}
            />
            <ProjectTaskCreateButton
              projectId={projectId}
              sourceLabel="Purchase Order"
              sourceRecordId={order.id}
              sourceRecordNumber={order.sourceRecordNumber}
              sourceHref={`/dashboard/projects/${projectId}/purchase-orders`}
              defaultTitle={purchaseOrderTaskTitle(order)}
              defaultDescription={purchaseOrderTaskDescription(order)}
              defaultAssigneeName={order.assigneeName}
              defaultCompanyName={order.companyName}
              defaultDueDate={order.dueDate}
              defaultPriority={order.priority}
              defaultTaskType="supplier_task"
              assigneeOptions={taskAssigneeOptions}
            />
            <ProjectPurchaseOrderPrintButton purchaseOrderId={order.id} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <span>{order.companyName ?? "Vendor TBD"}</span>
          <span>
            Site contact: {purchaseOrderSiteContactLabel({
              name: order.assigneeName,
              phone: order.siteContactPhone,
            })}
          </span>
          <span>
            {order.lines.length > 1
              ? `${order.lines.length} cost lines`
              : order.costCode ?? "Cost code TBD"}
          </span>
          <span>{formatDate(order.dueDate)}</span>
        </div>
        <p className="mt-3 text-sm font-medium">{money(order.amount)}</p>
        {order.vendorAcknowledgement && (
          <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">
              Vendor acknowledged receipt · {order.vendorAcknowledgement.responderName}
            </p>
            <p className="mt-1 text-xs">
              {new Date(
                order.vendorAcknowledgement.submittedAt
              ).toLocaleString("en-US")}
              {order.vendorAcknowledgement.note
                ? ` · ${order.vendorAcknowledgement.note}`
                : ""}
            </p>
          </div>
        )}
        {developerModeEnabled && (
          <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Accounting sync
            </p>
            <Badge variant="outline">{label(order.sageWriteStatus)}</Badge>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <span>
              Job: {order.sageJobNumber ?? order.sageJobId ?? "Compass only"}
            </span>
            <span>Vendor ID: {order.sageVendorId ?? "Not linked"}</span>
            <span>
              Phase:{" "}
              {order.lines.length > 1
                ? "Multiple"
                : order.sagePhaseCode ?? "TBD"}
            </span>
            <span>
              Cost code:{" "}
              {order.lines.length > 1
                ? "Multiple"
                : order.sageCostCode ?? order.costCode ?? "TBD"}
            </span>
          </div>
          {order.lines.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-md border bg-background">
              {order.lines.map((line) => (
                <div
                  key={line.id}
                  className="grid grid-cols-1 gap-2 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_6rem_6rem]"
                >
                  <span className="font-medium">#{line.lineNumber}</span>
                  <span className="truncate">{line.description}</span>
                  <span>
                    {line.quantity} {line.unit ?? ""}
                  </span>
                  <span>{money(line.unitCost)}</span>
                  <span className="font-medium">{money(line.amount)}</span>
                </div>
              ))}
            </div>
          )}
          </div>
        )}
      </div>

      <div className="hidden text-[11px] leading-tight text-black print:block">
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div className="flex items-center gap-3">
            <ProjectBrandLogo
              brand={brand}
              size={64}
              className="h-16 w-16 shrink-0 object-contain"
            />
            <div>
              <p className="text-sm font-bold uppercase">
                {brand.companyName}
              </p>
              <ProjectBrandContactDetails brand={brand} />
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-bold uppercase tracking-wide">
              Purchase Order
            </h1>
            <p className="mt-2 text-sm font-semibold">
              {order.sourceRecordNumber ?? "Unnumbered"}
            </p>
            <p>P.O. Date: {formatDate(order.sageOrderDate)}</p>
            <p>Required By: {formatDate(order.dueDate)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="border border-black">
            <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
              Vendor
            </div>
            <div className="min-h-20 p-2">
              <p className="font-semibold">{order.companyName ?? "Vendor TBD"}</p>
              {order.vendorAddress && (
                <p className="whitespace-pre-line">{order.vendorAddress}</p>
              )}
            </div>
          </div>
          <div className="border border-black">
            <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
              Project / Delivery
            </div>
            <div className="min-h-20 p-2">
              <p className="font-semibold">{projectLabel}</p>
              <p className="mt-2 text-[10px] font-bold uppercase">
                Delivery Location
              </p>
              <p className="whitespace-pre-line font-medium">
                {deliveryLocation ?? "TBD"}
              </p>
              <p>Site Contact: {order.assigneeName ?? "TBD"}</p>
              <p>Phone: {order.siteContactPhone ?? "TBD"}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 border border-black">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_4rem_4rem_5.5rem_6rem] border-b border-black px-2 py-1 text-xs font-bold uppercase">
            <span>Line</span>
            <span>Description</span>
            <span>Phase</span>
            <span>Cost Code</span>
            <span className="text-right">Qty</span>
            <span>Unit</span>
            <span className="text-right">Unit Cost</span>
            <span className="text-right">Amount</span>
          </div>
          {order.lines.map((line) => (
            <div
              key={line.id}
              className="grid min-h-9 grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_4rem_4rem_5.5rem_6rem] border-t border-black px-2 py-1"
            >
              <span>{line.lineNumber}</span>
              <span>{line.description}</span>
              <span>{line.phaseCode ?? "-"}</span>
              <span>{line.costCode ?? "-"}</span>
              <span className="text-right">{line.quantity}</span>
              <span>{line.unit ?? "-"}</span>
              <span className="text-right">{money(line.unitCost)}</span>
              <span className="text-right font-semibold">
                {money(line.amount)}
              </span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_6rem] border-t-2 border-black px-2 py-2 text-sm font-bold">
            <span className="text-right">Total</span>
            <span className="text-right">{money(order.amount)}</span>
          </div>
        </div>

        <div className="mt-4 border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
            Notes / Instructions
          </div>
          <div className="min-h-16 p-2">
            <p>{order.title}</p>
            {order.description && <p className="mt-1">{order.description}</p>}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-8 text-xs">
          <div className="border-t border-black pt-2">Authorized By</div>
          <div className="border-t border-black pt-2">Picked Up By</div>
          <div className="border-t border-black pt-2">Date</div>
        </div>
      </div>
    </article>
  )
}

export default async function ProjectPurchaseOrdersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly created?: string | readonly string[]
    readonly item?: string | readonly string[]
    readonly status?: string | readonly string[]
  }>
}) {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const query = await searchParams
  const createdPurchaseOrderId = Array.isArray(query.created)
    ? query.created[0] ?? null
    : query.created ?? null
  const focusedPurchaseOrderId = Array.isArray(query.item)
    ? query.item[0] ?? null
    : query.item ?? null
  const statusFilter = parseProjectOperationStatusFilter(query.status)
  const currentUser = await getCurrentUser()
  const developerModeEnabled = await isDeveloperModeEnabled(
    canManageProjectRegistry(currentUser)
  )
  const [
    projects,
    purchaseOrders,
    taskAssigneeOptions,
    siteContactOptions,
    contactsSummary,
    purchaseOrderCodingOptions,
  ] = await Promise.all([
    getProjects(),
    getProjectPurchaseOrders(id),
    getProjectTaskAssigneeOptions(id),
    getProjectPurchaseOrderSiteContactOptions(id),
    getProjectContactsSummary(id, "internal"),
    getProjectPurchaseOrderFormOptions(id),
  ]).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  const project = projects.find((item) => item.id === id)
  const brand = projectBrandFor({
    projectId: id,
    projectNumber: project?.projectNumber,
  })
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const emailRecipientOptions = buildProjectEmailRecipientOptions(
    contactsSummary.allContacts
  )
  const openPurchaseOrders = purchaseOrders.filter(
    (order) => !isClosedProjectOperationStatus(order.status)
  )
  const visiblePurchaseOrders = purchaseOrders.filter((order) =>
    projectOperationMatchesStatusFilter(order.status, statusFilter)
  )
  const openTotal = openPurchaseOrders.reduce(
    (total, order) => total + (order.amount ?? 0),
    0
  )

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <IconShoppingCart className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Purchase Orders
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} - ` : ""}
            {project?.name ?? "Project"} purchase orders and vendor commitments.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectQuickSwitcher
            projects={projects}
            currentProjectId={id}
            targetSection="purchase-orders"
            placeholder="Switch PO project..."
            className="w-full sm:w-[300px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary">
              {openPurchaseOrders.length} open / draft
            </Badge>
            <Badge variant="outline">{money(openTotal)}</Badge>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">P.O. queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stage commitments, print pickup copies, and email suppliers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {brand.department === "N" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${id}/nutech`}>
                  Nu-Tech order process
                  <IconExternalLink className="size-4" />
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/financials?tab=bills">
                Financials
                <IconExternalLink className="size-4" />
              </Link>
            </Button>
            <ProjectPurchaseOrderCreateForm
              projectId={id}
              jobsiteAddress={purchaseOrderCodingOptions.jobsiteAddress}
              contactOptions={taskAssignees}
              siteContactOptions={siteContactOptions}
              phaseOptions={purchaseOrderCodingOptions.phases}
              costCodeOptions={purchaseOrderCodingOptions.costCodes}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Filter purchase orders by status"
            className="flex flex-wrap gap-1"
          >
            {PURCHASE_ORDER_FILTERS.map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={statusFilter === option.value ? "secondary" : "ghost"}
              >
                <Link
                  href={`/dashboard/projects/${id}/purchase-orders?status=${option.value}`}
                >
                  {option.label}
                </Link>
              </Button>
            ))}
          </nav>
          <p className="text-xs text-muted-foreground">
            {visiblePurchaseOrders.length} of {purchaseOrders.length} shown
          </p>
        </div>

        {visiblePurchaseOrders.length > 0 ? (
          visiblePurchaseOrders.map((order) => (
            <PurchaseOrderCard
              key={order.id}
              brand={brand}
              order={order}
              projectId={id}
              projectLabel={
                `${project?.projectNumber ? `${project.projectNumber} - ` : ""}${
                  project?.name ?? "Project"
                }`
              }
              isCreated={order.id === createdPurchaseOrderId}
              isFocused={order.id === focusedPurchaseOrderId}
              taskAssigneeOptions={taskAssignees}
              siteContactOptions={siteContactOptions}
              emailRecipientOptions={emailRecipientOptions}
              jobsiteAddress={purchaseOrderCodingOptions.jobsiteAddress}
              phaseOptions={purchaseOrderCodingOptions.phases}
              costCodeOptions={purchaseOrderCodingOptions.costCodes}
              developerModeEnabled={developerModeEnabled}
            />
          ))
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconShoppingCart className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              {purchaseOrders.length === 0
                ? "No PO requests yet"
                : "No purchase orders match this filter"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {purchaseOrders.length === 0
                ? "Create a PO when a vendor commitment is ready."
                : "Choose another status to see the rest of the PO queue."}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
