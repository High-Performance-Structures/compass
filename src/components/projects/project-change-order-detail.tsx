import type * as React from "react"
import Link from "next/link"
import { ProjectChangeOrderEstimatePanel } from "@/components/projects/project-change-order-estimate-panel"
import { IconExternalLink } from "@tabler/icons-react"

import type {
  ProjectChangeOrderFormOptions,
  ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { PrintPreviewButton } from "@/components/print/print-preview-button"
import { ProjectChangeOrderCompletion } from "@/components/projects/project-change-order-completion"
import {
  ProjectChangeOrderAcceptanceSummary,
  ProjectChangeOrderRecordAcceptance,
} from "@/components/projects/project-change-order-acceptance"
import { ProjectChangeOrderExecutedDocument } from "@/components/projects/project-change-order-executed-document"
import { ProjectChangeOrderEditForm } from "@/components/projects/project-change-order-edit-form"
import { ProjectChangeOrderVersionLines } from "@/components/projects/project-change-order-version-lines"
import {
  DeveloperOnly,
} from "@/components/developer-mode-provider"
import { ProjectChangeOrderProvenance } from "@/components/projects/project-change-order-provenance"
import { ProjectVarianceLines, ReclassifyChangeOrdersButton } from "@/components/projects/project-variance-controls"
import type { ProjectVarianceOptions } from "@/app/actions/project-variances"
import { Badge } from "@/components/ui/badge"
import {
  changeOrderDisplayStatus,
  changeOrderStatusLabel,
  isChangeOrderStatus,
  isExecutedChangeOrderStatus,
} from "@/lib/change-orders/status"
import { PageHeader } from "@/components/page-header"

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
  paperTrailStatus = null,
  varianceOptions = null,
}: {
  readonly item: ProjectChangeOrderItem
  readonly backHref: string
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
  /** Staff pages pass the Drive copy status line; previews leave it out. */
  readonly paperTrailStatus?: React.ReactNode
  /** Staff pages pass the project's variance options; previews leave them out. */
  readonly varianceOptions?: ProjectVarianceOptions | null
}): React.ReactElement {
  const variance = item.recordType === "variance"
  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0 border-b pb-4"
        back={{ href: backHref, label: "Change orders" }}
        eyebrow={variance ? `Variance ${item.changeOrderNumber}${item.formerChangeOrderNumber ? ` (was ${item.formerChangeOrderNumber})` : ""}` : item.changeOrderNumber}
        title={item.title}
        // Who asked for it is a record fact, so it stays with the title.
        meta={
          item.sourceType === "buildertrend_import" ? (
            <ProjectChangeOrderProvenance />
          ) : (
            <>
              Requested by {item.requesterName}
              {item.requesterCompany ? ` · ${item.requesterCompany}` : ""}
            </>
          )
        }
        actions={
          <>
                {internal && varianceOptions ? (
                  <ReclassifyChangeOrdersButton
                    projectId={item.projectId}
                    items={[item]}
                    options={varianceOptions}
                    label={variance ? "Make change order" : "Make variance"}
                  />
                ) : null}
                {internal && item.manualAcceptance ? (
                  <ProjectChangeOrderRecordAcceptance
                    projectId={item.projectId}
                    changeOrderId={item.id}
                    options={item.manualAcceptance}
                  />
                ) : null}
                <PrintPreviewButton
                  link={{ projectId: item.projectId, document: "change-order", params: { changeOrderId: item.id }, number: item.changeOrderNumber }}
                />
                <Badge>{changeOrderDisplayStatus(item.status, item.sourceType)}</Badge>
                <Badge variant="outline">{money(item.amountCents)}</Badge>
                <Badge variant="outline">
                  {item.scheduleImpactDays === null
                    ? "Schedule impact not set"
                    : `${item.scheduleImpactDays} schedule day${item.scheduleImpactDays === 1 ? "" : "s"}`}
                </Badge>
                <Badge variant="secondary">
                  {item.sourceType === "buildertrend_import" ? "Audience: " : ""}{item.audience}
                </Badge>
                {item.budgetTreatment === "baseline_replacement" && (
                  <Badge variant="outline">Baseline replacement</Badge>
                )}
          </>
        }
      />
      {paperTrailStatus}
      {item.recordIssues.map((issue) => (
        <p key={issue} role="status" className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
          Record needs correcting: {issue}
        </p>
      ))}

      {variance && (
        <p className="border-l-2 border-l-primary px-3 py-2 text-sm text-muted-foreground">
          {internal
            ? "A variance moves cost on the cost codes it belongs to. It needs no owner signature: approving it updates the contract budget, and the owner sees it for information."
            : "This variance is a cost movement on your cost-plus contract, shared for your information. No approval is needed."}
        </p>
      )}

      {item.acceptance && (
        <ProjectChangeOrderAcceptanceSummary
          acceptance={item.acceptance}
          evidenceHref={
            item.acceptance.method === "written_approval" && item.executedDocumentAvailable
              ? `/api/projects/${encodeURIComponent(item.projectId)}/change-orders/${encodeURIComponent(item.id)}/executed-document`
              : null
          }
        />
      )}

      <ProjectChangeOrderVersionLines
        lines={item.lines}
        affectsBudget={item.budgetTreatment !== "baseline_replacement"}
      />

      {internal && variance && varianceOptions ? (
        <ProjectVarianceLines item={item} options={varianceOptions} costCodes={formOptions.costCodes} />
      ) : null}

      {item.canCompleteCostCodes && (
        <ProjectChangeOrderCompletion
          projectId={item.projectId}
          changeOrderId={item.id}
          amountCents={item.amountCents}
          executed={isExecutedChangeOrderStatus(item.status)}
          executedOn={item.executedAt?.slice(0, 10) ?? null}
          lines={item.lines}
          costCodes={formOptions.costCodes}
        />
      )}

      <ProjectChangeOrderEditForm
        item={item}
        internal={internal}
        formOptions={formOptions}
      />

      {!variance && isExecutedChangeOrderStatus(item.status) && item.audience === "owner" && (
        <ProjectChangeOrderExecutedDocument
          projectId={item.projectId}
          changeOrderId={item.id}
          available={item.executedDocumentAvailable}
          label={item.executedDocumentLabel}
          canManage={item.canManageExecutedDocument}
        />
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {item.kind === "description" && (
          <div className="border-y bg-background p-4">
            <h2 className="text-sm font-semibold">No cost change</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This change order documents a scope, plan or contract-language change. It doesn&apos;t change the
              contract price or the budget.
            </p>
          </div>
        )}
        {internal && !variance && (item.kind === "estimate" || item.kind === null) && item.budgetTreatment !== "baseline_replacement" && (
          <ProjectChangeOrderEstimatePanel
            projectId={item.projectId}
            changeOrderId={item.id}
            estimate={item.changeOrderEstimate}
            canStart={item.canEdit && !isExecutedChangeOrderStatus(item.status)}
            contractAssemblies={formOptions.contractAssemblies}
          />
        )}
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
                      ? "Historical record imported"
                    : event.eventType === "executed_document_added"
                      ? "Executed document added"
                    : event.eventType === "executed_document_replaced"
                      ? "Executed document replaced"
                    : event.eventType === "cost_codes_completed"
                      ? "Cost codes completed"
                    : event.eventType === "variance_approved"
                      ? "Variance approved"
                    : event.eventType === "variance_lines_saved"
                      ? "Variance lines saved"
                    : event.eventType === "reclassified"
                      ? "Reclassified"
                    : event.eventType === "acceptance_recorded"
                      ? "Owner acceptance recorded"
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
