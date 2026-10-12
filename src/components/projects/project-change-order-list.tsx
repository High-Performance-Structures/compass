import type * as React from "react"
import Link from "next/link"
import { IconFileInvoice } from "@tabler/icons-react"

import type {
  ProjectChangeOrderFormOptions,
  ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { ProjectChangeOrderCreateForm } from "@/components/projects/project-change-order-create-form"
import { ProjectChangeOrderProvenance } from "@/components/projects/project-change-order-provenance"
import { HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT } from "@/lib/change-orders/provenance"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { changeOrderDisplayStatus } from "@/lib/change-orders/status"
import { PageHeader } from "@/components/page-header"

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
      <PageHeader
        className="mb-0 border-b pb-3"
        icon={<IconFileInvoice className="size-5 text-muted-foreground" />}
        title="Change orders"
        actions={
          <>
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
          </>
        }
      />

      {items.some((item) => item.sourceType === "buildertrend_import") ? (
        <p className="text-xs text-muted-foreground">
          Imported change orders: {HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT}
        </p>
      ) : null}
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
                {item.sourceType === "buildertrend_import" && <ProjectChangeOrderProvenance variant="compact" />}
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
