import { IconShoppingCart } from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { getPurchaseOrderQueue } from "@/app/actions/purchase-order-priority"
import { PageHeader } from "@/components/page-header"
import { ActiveProjectSectionShortcut } from "@/components/projects/active-project-section-redirect"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { PurchaseOrderPriorityTable } from "@/components/purchase-orders/purchase-order-priority-table"
import { Badge } from "@/components/ui/badge"

/**
 * The company-wide ordering queue: every PO across the jobs that still has to
 * be ordered, in the purchaser's priority order, plus a way into one job's
 * full PO list.
 */
export default async function PurchaseOrderQueuePage() {
  const [queue, projects] = await Promise.all([getPurchaseOrderQueue(), getProjects()])

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
            <h2 className="text-sm font-semibold">Ordering queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Purchase orders from every open job that still need to be ordered, in the order to place them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queue.success && <Badge variant="secondary">{queue.data.rows.length} to order</Badge>}
            <ActiveProjectSectionShortcut targetSection="purchase-orders" noun="POs" />
          </div>
        </div>
        {queue.success ? (
          <PurchaseOrderPriorityTable
            rows={queue.data.rows}
            scope={{ kind: "organization" }}
            canReorder={queue.data.canReorder}
            statusFilter="all"
            emptyMessage="Nothing waiting to be ordered. New purchase orders appear here until they are ordered."
          />
        ) : (
          // Without the purchase order permission the job picker below still works.
          <p className="text-sm text-muted-foreground">
            The ordering queue isn&apos;t available to you. Open a job&apos;s purchase orders below.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">A job&apos;s purchase orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open one project to create POs or see its ordered, received and closed POs.
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
