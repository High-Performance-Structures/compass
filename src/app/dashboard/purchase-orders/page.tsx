import { IconShoppingCart } from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { getAllJobsPurchaseOrders } from "@/app/actions/purchase-order-lists"
import { PageHeader } from "@/components/page-header"
import { ActiveProjectSectionShortcut } from "@/components/projects/active-project-section-redirect"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { PurchaseOrderRecordTable } from "@/components/purchase-orders/purchase-order-record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { ALL_JOBS_PURCHASE_ORDER_LIMIT } from "@/lib/domain/operations/purchase-order-lists"
import { parsePurchaseOrderStatusFilter, purchaseOrderFilterOptions } from "@/lib/purchase-orders/status-filter"

/**
 * Every job's purchase orders on one sheet, opening on the open POs sorted by
 * required date, plus a way into one job's PO list.
 */
export default async function AllJobsPurchaseOrdersPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string | readonly string[] }>
}) {
  const statusFilter = parsePurchaseOrderStatusFilter((await searchParams).status)
  const [list, projects] = await Promise.all([getAllJobsPurchaseOrders(statusFilter), getProjects()])

  return (
    <ProjectContextWatermarkShell>
      <PageHeader
        className="mb-0"
        icon={<IconShoppingCart className="size-5 text-muted-foreground" />}
        title="Purchase Orders"
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">All jobs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Purchase orders from every job. Open a row to see the P.O. on its job.
            </p>
          </div>
          <ActiveProjectSectionShortcut targetSection="purchase-orders" noun="POs" />
        </div>
        {list.success ? (
          <>
            <StatusFilterBar
              kind="link"
              label="Filter purchase orders by status"
              options={purchaseOrderFilterOptions(list.data.statusCounts)}
              selected={statusFilter}
              hrefFor={(value) => `/dashboard/purchase-orders?status=${value}`}
            />
            {list.data.truncated && (
              <p role="status" className="text-sm text-muted-foreground">
                Showing the first {ALL_JOBS_PURCHASE_ORDER_LIMIT} purchase orders by required date. Choose a status to
                narrow the list; search looks only within these.
              </p>
            )}
            <PurchaseOrderRecordTable
              rows={list.data.rows}
              allJobs
              statusFilter="all"
              emptyMessage={
                statusFilter === "open"
                  ? "No open purchase orders. Choose All to see every P.O."
                  : "No purchase orders match this filter."
              }
            />
          </>
        ) : (
          // Without the purchase order permission the job picker below still works.
          <p className="text-sm text-muted-foreground">
            Every job&apos;s purchase orders aren&apos;t available to you. Open a job&apos;s purchase orders below.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">A job&apos;s purchase orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open one project to create POs and manage them.
          </p>
        </div>
        {projects.length > 0 ? (
          <div className="max-w-xl">
            <ProjectQuickSwitcher
              projects={projects}
              targetSection="purchase-orders"
              placeholder="Search projects for POs..."
              className="w-full"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No projects yet. Add or sync projects first.</p>
        )}
      </section>
    </ProjectContextWatermarkShell>
  )
}
