import { IconArchive } from "@tabler/icons-react"
import Link from "next/link"
import type * as React from "react"

import type {
  ArchivedBuildertrendChangeOrderHold,
} from "@/app/actions/project-archived-change-orders"
import type { ArchivedBuildertrendChangeOrder } from "@/lib/change-orders/buildertrend-archive"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function ProjectArchivedChangeOrderList({
  records,
  holds,
  detailBaseHref,
}: {
  readonly records: readonly ArchivedBuildertrendChangeOrder[]
  readonly holds: readonly ArchivedBuildertrendChangeOrderHold[]
  readonly detailBaseHref: string
}): React.ReactElement | null {
  if (records.length === 0 && holds.length === 0) return null

  return (
    <section className="space-y-3 border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconArchive className="size-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Buildertrend archive</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified historical source records. These are not operational
            Compass change orders and do not affect project budgets.
          </p>
        </div>
        <Badge variant="outline">Internal history</Badge>
      </div>

      {records.length > 0 && (
        <div className="divide-y border-y bg-background">
          {records.map((record) => (
            <article
              key={record.id}
              className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {record.changeOrderNumber}
                  </p>
                  <Badge variant="outline">{record.displayStatus}</Badge>
                  <Badge variant="secondary">{record.purpose}</Badge>
                  <Badge variant="outline">
                    Historical source · not budget-active
                  </Badge>
                </div>
                <h3 className="mt-2 font-semibold">{record.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {record.scope}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Requester unknown
                  {record.approvalActor
                    ? ` · Source approval actor: ${record.approvalActor}`
                    : " · Source approval actor not captured"}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`${detailBaseHref}/archive/${encodeURIComponent(record.id)}`}
                >
                  Review archive
                </Link>
              </Button>
            </article>
          ))}
        </div>
      )}

      {holds.length > 0 && (
        <div className="border-y bg-background px-4 py-3">
          <p className="text-sm font-medium">
            {holds.length} archived record{holds.length === 1 ? "" : "s"} held
            for evidence review
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Source details stay withheld until immutable project and record
            evidence reconcile.
          </p>
        </div>
      )}
    </section>
  )
}
