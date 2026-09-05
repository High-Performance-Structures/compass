import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react"

import type {
  ProjectChangeOrderFormOptions,
  ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { ProjectChangeOrderEditForm } from "@/components/projects/project-change-order-edit-form"
import {
  DeveloperOnly,
  WorkerOnly,
} from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  changeOrderDisplayStatus,
  changeOrderStatusLabel,
  isChangeOrderStatus,
} from "@/lib/change-orders/status"

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function money(cents: number | null): string {
  if (cents === null) return "Not determined"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function historyStatusLabel(value: string | null): string {
  return value && isChangeOrderStatus(value)
    ? changeOrderStatusLabel(value)
    : value ?? "Updated"
}

export function ProjectChangeOrderDetail({
  item,
  backHref,
  internal,
  formOptions,
}: {
  readonly item: ProjectChangeOrderItem
  readonly backHref: string
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {item.changeOrderNumber}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{item.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Requested by {item.requesterName}
              {item.requesterCompany ? ` · ${item.requesterCompany}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{changeOrderDisplayStatus(item.status, item.sourceType)}</Badge>
            <Badge variant="outline">{money(item.amountCents)}</Badge>
            <Badge variant="outline">
              {item.scheduleImpactDays === null
                ? "Schedule impact not set"
                : `${item.scheduleImpactDays} schedule day${item.scheduleImpactDays === 1 ? "" : "s"}`}
            </Badge>
            <Badge variant="secondary">{item.audience}</Badge>
            {item.budgetTreatment === "baseline_replacement" && (
              <Badge variant="outline">Baseline replacement</Badge>
            )}
          </div>
        </div>
      </header>

      <ProjectChangeOrderEditForm
        item={item}
        internal={internal}
        formOptions={formOptions}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        {item.budgetTreatment === "baseline_replacement" && (
          <div className="border-y bg-background p-4">
            <h2 className="text-sm font-semibold">Linked estimate package</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {item.baselineEstimate
                ? `${item.baselineEstimate.estimateNumber} v${item.baselineEstimate.versionNumber}`
                : "Original estimate"}
              {" → "}
              {item.replacementEstimate
                ? `${item.replacementEstimate.estimateNumber} v${item.replacementEstimate.versionNumber}`
                : "Revised estimate"}
            </p>
            <div className="mt-3 grid gap-2">
              {internal && item.replacementEstimate && (
                <Link
                  href={`/dashboard/projects/${encodeURIComponent(item.projectId)}/estimate?estimateId=${encodeURIComponent(item.replacementEstimate.id)}`}
                  className="flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
                >
                  Open revised estimate workspace
                  <IconExternalLink className="size-4 shrink-0" />
                </Link>
              )}
              {item.replacementEstimateUrl && (
                <a
                  href={item.replacementEstimateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
                >
                  Complete revised estimate
                  <IconExternalLink className="size-4 shrink-0" />
                </a>
              )}
              {item.estimateComparisonUrl && (
                <a
                  href={item.estimateComparisonUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
                >
                  Estimate version comparison
                  <IconExternalLink className="size-4 shrink-0" />
                </a>
              )}
            </div>
            {item.rebaselineCompletedAt && (
              <p className="mt-3 border-l-2 border-l-primary px-3 py-2 text-xs text-muted-foreground">
                Compass budget rebaselined {formatDate(item.rebaselineCompletedAt)}.
                The prior estimate and budget remain in revision history.
              </p>
            )}
          </div>
        )}
        <div className="border-y bg-background p-4">
          <h2 className="text-sm font-semibold">Supporting documents</h2>
          {item.documents.length > 0 ? (
            <div className="mt-3 space-y-2">
              {item.documents.map((document) => (
                <a
                  key={document.id}
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
                >
                  <span>
                    <span className="font-medium">{document.label}</span>
                    {document.notes && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {document.notes}
                      </span>
                    )}
                  </span>
                  <IconExternalLink className="size-4 shrink-0" />
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No supporting documents.
            </p>
          )}
        </div>
        <DeveloperOnly>
          <div className="border-y bg-background p-4">
            <h2 className="text-sm font-semibold">Integration boundaries</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Foxit signature</dt>
                <dd className="font-medium">{item.foxitStatus}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Sage</dt>
                <dd className="font-medium">{item.sageStatus}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Compass records readiness only. No document is sent to Foxit and no
              accounting record is written to Sage from this workflow.
            </p>
          </div>
        </DeveloperOnly>
      </section>

      <section className="border-y bg-background p-4">
        <h2 className="text-sm font-semibold">Activity history</h2>
        <div className="mt-3 divide-y">
          {item.history.map((event) => (
            <article key={event.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {event.eventType === "status_transition"
                    ? `${event.fromStatus ? historyStatusLabel(event.fromStatus) : "Created"} → ${historyStatusLabel(event.toStatus)}`
                    : event.eventType === "baseline_replaced"
                      ? "Estimate and budget baseline replaced"
                    : event.eventType === "buildertrend_import"
                      ? <><DeveloperOnly>Imported from Buildertrend</DeveloperOnly><WorkerOnly>Request created</WorkerOnly></>
                    : event.eventType === "created"
                      ? "Request created"
                      : "Request updated"}
                </p>
                <time className="text-xs text-muted-foreground">
                  {formatDate(event.createdAt)}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.actorName} · {event.actorRole}
              </p>
              {event.note && <p className="mt-2">{event.note}</p>}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
