import type * as React from "react"
import { IconFileInvoice } from "@tabler/icons-react"

import type {
  ProjectChangeOrderFormOptions,
  ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { ProjectChangeOrderCreateForm } from "@/components/projects/project-change-order-create-form"
import { ProjectChangeOrderRecordTable } from "@/components/projects/project-change-order-record-table"
import { NewVarianceButton, ReclassifyChangeOrdersButton } from "@/components/projects/project-variance-controls"
import type { ProjectVarianceOptions } from "@/app/actions/project-variances"
import { Badge } from "@/components/ui/badge"
import type { ChangeOrderListFilter } from "@/lib/change-orders/record-list"
import { PageHeader } from "@/components/page-header"

export function ProjectChangeOrderList({
  projectId,
  items,
  detailBaseHref,
  internal,
  formOptions,
  canCreate = true,
  varianceOptions = null,
  initialFilter = "open",
}: {
  readonly projectId: string
  readonly items: readonly ProjectChangeOrderItem[]
  readonly detailBaseHref: string
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
  readonly canCreate?: boolean
  /** Staff pages pass the project's variance options; owner and vendor views leave them out. */
  readonly varianceOptions?: ProjectVarianceOptions | null
  /** The status filter the sheet opens on. */
  readonly initialFilter?: ChangeOrderListFilter
}): React.ReactElement {
  const openCount = items.filter(
    (item) => !["closed", "declined", "void"].includes(item.status)
  ).length

  return (
    <section className="space-y-4">
      <PageHeader
        className="mb-0 border-b pb-3"
        icon={<IconFileInvoice className="size-5 text-muted-foreground" />}
        title={items.some((item) => item.recordType === "variance") || varianceOptions?.allowsVariances ? "Change orders and variances" : "Change orders"}
        actions={
          <>
            <div className="flex items-center gap-2">
              <Badge variant={openCount > 0 ? "secondary" : "outline"}>
                {openCount} active
              </Badge>
              {internal && varianceOptions ? (
                <>
                  <NewVarianceButton projectId={projectId} detailBaseHref={detailBaseHref} options={varianceOptions} />
                  <ReclassifyChangeOrdersButton projectId={projectId} items={items} options={varianceOptions} />
                </>
              ) : null}
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

      {items.length > 0 ? (
        <ProjectChangeOrderRecordTable items={items} detailBaseHref={detailBaseHref} initialFilter={initialFilter} />
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
