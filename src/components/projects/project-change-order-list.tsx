import type * as React from "react"
import Link from "next/link"
import { IconFileInvoice } from "@tabler/icons-react"

import type {
  ProjectChangeOrderFormOptions,
  ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { ProjectChangeOrderCreateForm } from "@/components/projects/project-change-order-create-form"
import { ProjectChangeOrderProvenance } from "@/components/projects/project-change-order-provenance"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { changeOrderDisplayStatus } from "@/lib/change-orders/status"

function money(cents: number | null): string {
  if (cents === null) return "Amount not determined"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

export function ProjectChangeOrderList({
  projectId,
  items,
  detailBaseHref,
  internal,
  formOptions,
  canCreate = true,
}: {
  readonly projectId: string
  readonly items: readonly ProjectChangeOrderItem[]
  readonly detailBaseHref: string
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
  readonly canCreate?: boolean
}): React.ReactElement {
  const openCount = items.filter(
    (item) => !["closed", "declined", "void"].includes(item.status)
  ).length

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
        <div>
          <div className="flex items-center gap-2">
            <IconFileInvoice className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Change orders</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Request, review, price, approve, and track scope, cost, and budget changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={openCount > 0 ? "secondary" : "outline"}>
            {openCount} active
          </Badge>
          {canCreate && (
            <ProjectChangeOrderCreateForm
              projectId={projectId}
              detailBaseHref={detailBaseHref}
              internal={internal}
              formOptions={formOptions}
            />
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="divide-y border-y bg-background">
          {items.map((item) => (
            <article
              key={item.id}
              className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {item.changeOrderNumber}
                  </p>
                  <Badge variant="outline">
                    {changeOrderDisplayStatus(item.status, item.sourceType)}
                  </Badge>
                  {item.sourceType !== "buildertrend_import" && (
                    <Badge variant="secondary">{item.requesterType}</Badge>
                  )}
                  {item.budgetTreatment === "baseline_replacement" && (
                    <Badge variant="outline">Baseline replacement</Badge>
                  )}
                </div>
                <h2 className="mt-2 font-semibold">{item.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {item.scope}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {money(item.amountCents)}
                  {item.sourceType !== "buildertrend_import"
                    ? ` · Requested by ${item.requesterName}`
                    : ""}
                  {item.scheduleImpactDays !== null
                    ? ` · ${item.scheduleImpactDays} schedule day${item.scheduleImpactDays === 1 ? "" : "s"}`
                    : ""}
                </p>
                {item.sourceType === "buildertrend_import" && <ProjectChangeOrderProvenance />}
              </div>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`${detailBaseHref}/${encodeURIComponent(item.id)}`}
                >
                  Open
                </Link>
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="border-y bg-background p-8 text-center">
          <IconFileInvoice className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">No change requests yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use Request change to document the first scope, pricing, or owner
            request.
          </p>
        </div>
      )}
    </section>
  )
}
