export const dynamic = "force-dynamic"

import Link from "next/link"
import {
  IconArrowRight,
  IconCalendarEvent,
  IconShoppingCart,
  IconPackages,
  IconTool,
} from "@tabler/icons-react"

import { getNuTechOrderDashboard } from "@/app/actions/nutech-orders"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { nuTechOrderStatusLabel } from "@/lib/nutech/workflow"

function dateLabel(value: string | null): string {
  if (!value) return "No delivery date"
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function NuTechOrdersPage(): Promise<React.ReactElement> {
  const orders = await getNuTechOrderDashboard()
  const activeOrders = orders.filter(
    (order) => !["complete", "cancelled"].includes(order.orderStatus)
  )

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconTool className="size-5 text-brand-nutech-gold-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Nu-Tech Orders
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Fox Blocks sales, staff takeoffs, bracing rentals, Airlite purchase
            orders, and vendor-invoice release tracking.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{activeOrders.length} active</Badge>
          <Badge variant="outline">{orders.length} N projects</Badge>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">Department order queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a project to continue its quantity, estimate, PO, or invoice
              handoff.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/nutech/catalog">
                <IconPackages className="size-4" />
                Product catalog
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/projects?department=N">Nu-Tech projects</Link>
            </Button>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconTool className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No Nu-Tech projects found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create or reconcile an N-numbered project to begin its order process.
            </p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-background">
            {orders.map((order) => (
              <article
                key={order.projectId}
                className="grid gap-3 p-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.8fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {order.projectNumber ?? order.projectName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {order.projectNumber ? order.projectName : order.clientName ?? "Nu-Tech project"}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {order.orderStatus === "not_started"
                      ? "Not started"
                      : nuTechOrderStatusLabel(order.orderStatus)}
                  </Badge>
                  <span className="inline-flex items-center gap-1">
                    <IconCalendarEvent className="size-3.5" />
                    {dateLabel(order.requestedDeliveryDate)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconShoppingCart className="size-3.5" />
                    {order.openPurchaseOrderCount} open PO
                  </span>
                </div>
                <Button asChild size="sm">
                  <Link href={`/dashboard/projects/${order.projectId}/nutech`}>
                    Continue
                    <IconArrowRight className="size-4" />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
