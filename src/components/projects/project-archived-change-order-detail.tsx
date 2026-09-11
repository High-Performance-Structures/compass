import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react"
import Link from "next/link"
import type * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ArchivedBuildertrendChangeOrder } from "@/lib/change-orders/buildertrend-archive"

export function ProjectArchivedChangeOrderDetail({
  record,
  backHref,
}: {
  readonly record: ArchivedBuildertrendChangeOrder
  readonly backHref: string
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={backHref}>
          <IconArrowLeft className="size-4" />
          Change orders
        </Link>
      </Button>

      <header className="border-b pb-4">
        <p className="text-xs font-medium text-muted-foreground">
          {record.changeOrderNumber}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{record.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{record.displayStatus}</Badge>
          <Badge variant="secondary">{record.purpose}</Badge>
          <Badge variant="outline">Historical source · not budget-active</Badge>
          <Badge variant="outline">Internal history</Badge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          This immutable Buildertrend capture is read-only. It is not a Compass
          workflow status, approval, owner request, or contract-budget input.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="border-y bg-background p-4">
          <h2 className="text-sm font-semibold">Source roles</h2>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Requester</dt>
              <dd className="font-medium">{record.requester}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Source approval actor
              </dt>
              <dd className="font-medium">
                {record.approvalActor ?? "Not captured"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            An approval actor or owner-labelled source field is not evidence of
            who requested the change.
          </p>
        </div>

        <div className="border-y bg-background p-4">
          <h2 className="text-sm font-semibold">Archive evidence</h2>
          {record.archiveEvidence.status === "verified" ? (
            <a
              href={record.archiveEvidence.driveUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
            >
              Verified source archive
              <IconExternalLink className="size-4 shrink-0" />
            </a>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {record.archiveEvidence.reason}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Provenance manifest: {record.manifestEvidence.status === "verified"
              ? "verified"
              : record.manifestEvidence.reason}
          </p>
        </div>
      </section>

      <section className="border-y bg-background p-4">
        <h2 className="text-sm font-semibold">Captured scope</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm">{record.scope}</p>
      </section>

      <section className="border-y bg-background p-4">
        <h2 className="text-sm font-semibold">Captured current lines</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Historical display values only. These lines are not posted to the
          Compass contract budget.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Line</th>
                <th className="px-2 py-2 font-medium">Cost code</th>
                <th className="px-2 py-2 font-medium">Quantity</th>
                <th className="px-2 py-2 font-medium">Unit cost</th>
                <th className="px-2 py-2 text-right font-medium">
                  Client price
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {record.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-2 py-2">{line.lineNumber}</td>
                  <td className="px-2 py-2">
                    <span className="block">{line.costCodeDisplay}</span>
                    {line.description !== `Line ${line.lineNumber}` && (
                      <span className="text-xs text-muted-foreground">
                        {line.description}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">{line.quantityDisplay}</td>
                  <td className="px-2 py-2">{line.unitCostDisplay}</td>
                  <td className="px-2 py-2 text-right">
                    {line.clientPriceDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-y bg-background p-4">
        <h2 className="text-sm font-semibold">Captured source activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Times are shown exactly as Buildertrend displayed them; source
          timezone was not established.
        </p>
        <div className="mt-3 divide-y">
          {record.activity.map((event) => (
            <article key={event.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{event.kind}</p>
                <time className="text-xs text-muted-foreground">
                  {event.displayedAt}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.actor} · Buildertrend source actor
              </p>
              {event.details.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {event.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
