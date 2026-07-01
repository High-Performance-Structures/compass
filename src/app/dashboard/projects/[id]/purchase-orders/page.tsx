import type * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconExternalLink,
  IconShoppingCart,
} from "@tabler/icons-react"

import {
  getProjectPurchaseOrders,
  type ProjectPurchaseOrderItem,
} from "@/app/actions/project-operations"
import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
import { ProjectListFilters } from "@/components/projects/project-list-filters"
import { ProjectPurchaseOrderDeleteButton } from "@/components/projects/project-purchase-order-delete-button"
import { ProjectPurchaseOrderEmailButton } from "@/components/projects/project-purchase-order-email-button"
import { ProjectPurchaseOrderCreateForm } from "@/components/projects/project-purchase-order-create-form"
import { ProjectPurchaseOrderPrintButton } from "@/components/projects/project-purchase-order-print-button"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

function paramValue(value: string | readonly string[] | undefined): string {
  if (typeof value === "string") return value
  return value?.[0] ?? ""
}

function matchesText(
  values: readonly (string | null | undefined)[],
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true

  return values.some((value) =>
    (value ?? "").toLowerCase().includes(normalized)
  )
}

function matchesDateRange(value: string | null, from: string, to: string): boolean {
  if (from.length === 0 && to.length === 0) return true
  if (!value) return false
  return (from.length === 0 || value >= from) && (to.length === 0 || value <= to)
}

function matchesPurchaseOrderFilters(
  order: ProjectPurchaseOrderItem,
  filters: {
    readonly q: string
    readonly status: string
    readonly from: string
    readonly to: string
  }
): boolean {
  const statusMatches =
    filters.status.length === 0 ||
    filters.status === "all" ||
    order.status === filters.status

  return (
    statusMatches &&
    matchesDateRange(order.dueDate, filters.from, filters.to) &&
    matchesText(
      [
        order.sourceRecordNumber,
        order.title,
        order.description,
        order.companyName,
        order.vendorEmail,
        order.assigneeName,
        order.costCode,
        order.sageJobId,
        order.sageJobNumber,
        order.sageVendorId,
        order.sageVendorName,
        order.sagePhaseCode,
        order.sageCostCode,
        order.sageShipTo,
        order.sageTaxGroup,
        order.syncStatus,
        order.sageWriteStatus,
        ...order.lines.flatMap((line) => [
          line.description,
          line.costCode,
          line.phaseCode,
          line.unit,
          line.taxGroup,
          line.syncStatus,
        ]),
      ],
      filters.q
    )
  )
}

function PurchaseOrderCard({
  order,
  projectId,
  projectLabel,
  isCreated,
  taskAssigneeOptions,
}: {
  readonly order: ProjectPurchaseOrderItem
  readonly projectId: string
  readonly projectLabel: string
  readonly isCreated: boolean
  readonly taskAssigneeOptions: React.ComponentProps<
    typeof ProjectTaskCreateButton
  >["assigneeOptions"]
}): React.ReactElement {
  return (
    <article
      data-po-id={order.id}
      className={cn(
        "po-printable border-y border-r border-l-2 border-l-[#6f471f] bg-background px-4 py-3 print:border-0 print:p-0",
        isCreated && "border-l-[#3f7d4d] bg-card"
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
            <Badge variant={order.status === "draft" ? "secondary" : "outline"}>
              {label(order.status)}
            </Badge>
            <Badge variant="outline">{label(order.syncStatus)}</Badge>
            {order.priority === "high" && (
              <Badge variant="destructive">High</Badge>
            )}
            <ProjectPurchaseOrderEmailButton
              projectId={projectId}
              purchaseOrderId={order.id}
              poNumber={order.sourceRecordNumber}
              projectLabel={projectLabel}
              supplierName={order.companyName}
              supplierEmail={order.vendorEmail}
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
          <span>{order.assigneeName ?? "Owner TBD"}</span>
          <span>
            {order.lines.length > 1
              ? `${order.lines.length} cost lines`
              : order.costCode ?? "Cost code TBD"}
          </span>
          <span>{formatDate(order.dueDate)}</span>
        </div>
        <p className="mt-3 text-sm font-medium">{money(order.amount)}</p>
        <div className="mt-3 border-y bg-muted/10 py-3">
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
            <div className="mt-3 overflow-hidden border bg-background">
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
      </div>

      <div className="hidden text-[11px] leading-tight text-black print:block">
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div className="flex items-center gap-3">
            <img
              src="/department-logos/hps-h-green.svg"
              alt="HPS logo"
              className="h-16 w-16 shrink-0 object-contain"
            />
            <div>
              <p className="text-sm font-bold uppercase">
                High Performance Structures, Inc.
              </p>
              <p>P.O. Box 878</p>
              <p>Woodland Park, CO 80866</p>
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
              <p>Vendor ID: {order.sageVendorId ?? "Not linked"}</p>
            </div>
          </div>
          <div className="border border-black">
            <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
              Project / Pickup
            </div>
            <div className="min-h-20 p-2">
              <p className="font-semibold">{projectLabel}</p>
              <p>Ship To / Pickup: {order.sageShipTo ?? "TBD"}</p>
              <p>Internal Owner: {order.assigneeName ?? "TBD"}</p>
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
    readonly q?: string | readonly string[]
    readonly status?: string | readonly string[]
    readonly from?: string | readonly string[]
    readonly to?: string | readonly string[]
  }>
}) {
  const { id } = await params
  const query = await searchParams
  const createdPurchaseOrderId = Array.isArray(query.created)
    ? query.created[0] ?? null
    : query.created ?? null
  const filters = {
    q: paramValue(query.q),
    status: paramValue(query.status),
    from: paramValue(query.from),
    to: paramValue(query.to),
  }
  const [projects, purchaseOrders, taskAssigneeOptions] = await Promise.all([
    getProjects(),
    getProjectPurchaseOrders(id),
    getProjectTaskAssigneeOptions(id),
  ])
  const project = projects.find((item) => item.id === id)
  const taskAssignees = [
    ...taskAssigneeOptions.projectContacts,
    ...taskAssigneeOptions.directoryContacts,
  ]
  const openPurchaseOrders = purchaseOrders.filter(
    (order) => !["closed", "void", "complete"].includes(order.status)
  )
  const openTotal = openPurchaseOrders.reduce(
    (total, order) => total + (order.amount ?? 0),
    0
  )
  const filteredPurchaseOrders = purchaseOrders.filter((order) =>
    matchesPurchaseOrderFilters(order, filters)
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
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/financials?tab=bills">
                Financials
                <IconExternalLink className="size-4" />
              </Link>
            </Button>
            <ProjectPurchaseOrderCreateForm projectId={id} />
          </div>
        </div>

        <ProjectListFilters
          baseHref={`/dashboard/projects/${id}/purchase-orders`}
          q={filters.q}
          status={filters.status}
          from={filters.from}
          to={filters.to}
          statusOptions={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "sent", label: "Sent" },
            { value: "approved", label: "Approved" },
            { value: "ordered", label: "Ordered" },
            { value: "complete", label: "Complete" },
            { value: "closed", label: "Closed" },
            { value: "void", label: "Void" },
          ]}
          searchPlaceholder="Search PO number, vendor, cost code, line item..."
          resultLabel={`${filteredPurchaseOrders.length} of ${
            purchaseOrders.length
          } purchase order${purchaseOrders.length === 1 ? "" : "s"} shown`}
        />

        {filteredPurchaseOrders.length > 0 ? (
          filteredPurchaseOrders.map((order) => (
            <PurchaseOrderCard
              key={order.id}
              order={order}
              projectId={id}
              projectLabel={
                `${project?.projectNumber ? `${project.projectNumber} - ` : ""}${
                  project?.name ?? "Project"
                }`
              }
              isCreated={order.id === createdPurchaseOrderId}
              taskAssigneeOptions={taskAssignees}
            />
          ))
        ) : (
          <div className="border border-dashed bg-background p-8 text-center">
            <IconShoppingCart className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No P.O.s found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clear the filters or create a PO when a vendor commitment is ready.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
