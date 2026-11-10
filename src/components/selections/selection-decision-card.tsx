"use client"

/*
 * One selection decision in full: the specification, allowance and owner
 * price, approval, requests and history. Owners and subs see it inline on
 * their Selections page; staff open it in the record drawer from Publish to
 * owner, where it also carries the publish form and quote / PO links.
 */
import { SearchableCombobox } from "@/components/searchable-combobox"
import * as React from "react"
import Link from "next/link"
import { Controller, useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import {
  approveSelectionDecision,
  linkSelectionPurchaseOrder,
  unlinkSelectionProcurement,
} from "@/app/actions/selection-decisions"
import type {
  SelectionDecisionItem,
  SelectionWorkspace,
} from "@/lib/selections/types"
import { selectionMoney, safeSelectionUrl } from "@/lib/selections/decisions"
import { SelectionPublishForm } from "./selection-publish-form"
import {
  SelectionRequestForm,
  SelectionRequestCard,
} from "./selection-request-form"
import { Button } from "@/components/ui/button"
import { ProjectPortalPrintButton } from "@/components/projects/project-portal-print-button"
import { selectionReport } from "@/lib/selections/report"
import { selectionProgressLabel } from "@/lib/domain/selections/status-labels"
import type { ReportProject } from "@/lib/print/portal-report"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

function productHref(value: string | null): string | null {
  try {
    return safeSelectionUrl(value)
  } catch {
    return null
  }
}
export function DecisionCard({
  item,
  workspace,
  reportProject,
}: {
  readonly item: SelectionDecisionItem
  readonly workspace: SelectionWorkspace
  readonly reportProject?: ReportProject
}): React.ReactElement {
  const router = useRouter(),
    [requestOpen, setRequestOpen] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [pending, start] = React.useTransition()
  const { control, handleSubmit, watch } = useForm<{ operationId: string }>({
    defaultValues: { operationId: "" },
  })
  const chosenPurchaseOrder = watch("operationId")
  const staff = workspace.audience === "staff",
    owner = workspace.audience === "owner",
    spec = staff ? item.currentSpec : item.spec
  const url = productHref(spec.productUrl),
    difference =
      item.quotedCents !== null && item.allowanceCents !== null
        ? item.quotedCents - item.allowanceCents
        : null
  function approve(): void {
    start(async () => {
      setError(null)
      const result = await approveSelectionDecision(
        workspace.projectId,
        item.id,
        item.revision,
      )
      if (!result.success) setError(result.error)
      else router.refresh()
    })
  }
  return (
    <article
      id={`selection-${item.id}`}
      className="scroll-mt-20 border-t py-5"
      aria-label={spec.name}
    >
      {reportProject && (
        <div className="mb-2 flex justify-end">
          <ProjectPortalPrintButton
            project={reportProject}
            report={selectionReport([item], workspace.audience, workspace.statusLabels)}
          />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {spec.roomName} · {spec.category}
          </p>
          <h2 className="mt-1 font-semibold">{spec.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {workspace.audience === "sub_vendor"
            ? `Approved specification · Revision ${item.revision}`
            : item.decisionDueDate
              ? `Decision due ${item.decisionDueDate}`
              : "Deadline to be confirmed"}
        </p>
      </div>
      <p className="mt-2 text-sm">
        {[spec.manufacturer, spec.model, spec.colorFinish]
          .filter(Boolean)
          .join(" · ") || "Product to be selected"}
      </p>
      {spec.description && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
          {spec.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {spec.quantity !== null && <span>Quantity: {spec.quantity}</span>}
        {spec.supplierName && <span>Supplier: {spec.supplierName}</span>}
        {url && (
          <a
            className="text-primary underline"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            View product ↗
          </a>
        )}
        <span>Progress: {selectionProgressLabel(item.status, workspace.statusLabels)}</span>
      </div>
      {(owner || staff) && (
        <dl className="mt-4 grid grid-cols-3 gap-3 border-y py-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Allowance</dt>
            <dd className="mt-1">{selectionMoney(item.allowanceCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Price to owner</dt>
            <dd className="mt-1">{selectionMoney(item.quotedCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Difference</dt>
            <dd className="mt-1">
              {difference === null
                ? "Pending"
                : `${difference > 0 ? "+" : ""}${selectionMoney(difference)}`}
            </dd>
          </div>
        </dl>
      )}
      {item.scheduleImpact && (
        <p className="mt-3 text-sm">
          <span className="font-medium">Timing: </span>
          {item.scheduleImpact}
        </p>
      )}
      {item.ownerNote && (
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.ownerNote}</p>
      )}
      {!item.current && (
        <p role="status" className="mt-3 text-sm text-destructive">
          Specification changed — the team must publish a revised decision.
          Previous approval does not cover the new specification.
        </p>
      )}
      {item.approvedAt && (
        <p className="mt-3 text-sm text-primary">
          Revision {item.revision} approved by {item.approvedByName} ·{" "}
          {new Date(item.approvedAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      )}
      {item.changeOrderId && (
        <Link
          className="mt-3 inline-block text-sm text-primary underline"
          href={
            owner
              ? `/preview/projects/${encodeURIComponent(workspace.projectId)}/owner/change-orders/${encodeURIComponent(item.changeOrderId)}`
              : `/dashboard/projects/${encodeURIComponent(workspace.projectId)}/change-orders/${encodeURIComponent(item.changeOrderId)}`
          }
        >
          Review related change order →
        </Link>
      )}
      {owner && workspace.canWrite && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setRequestOpen(!requestOpen)}
            >
              Request pricing / alternative
            </Button>
            {!item.approvedAt && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={pending || item.approvalBlocker !== null}>
                    Approve selection
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve {spec.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You are approving revision {item.revision}:{" "}
                      {[spec.manufacturer, spec.model, spec.colorFinish]
                        .filter(Boolean)
                        .join(" · ") || spec.name}
                      , at {selectionMoney(item.quotedCents)} with an allowance
                      of {selectionMoney(item.allowanceCents)}. Timing:{" "}
                      {item.scheduleImpact}. Your name, time, and the exact
                      terms will be recorded. This does not place an order or
                      replace change-order approval.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                    <AlertDialogAction onClick={approve}>
                      Approve this revision
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          {!item.approvedAt && item.approvalBlocker && (
            <p className="text-xs text-muted-foreground">
              {item.approvalBlocker}
            </p>
          )}
          {requestOpen && (
            <SelectionRequestForm
              projectId={workspace.projectId}
              item={item}
              request={null}
              onDone={() => setRequestOpen(false)}
            />
          )}
        </div>
      )}
      {owner && !workspace.canWrite && (
        <p className="mt-3 text-xs text-muted-foreground">
          Preview only. The assigned owner can request pricing and approve
          published decisions.
        </p>
      )}
      {staff && workspace.canWrite && (
        <>
          <SelectionPublishForm
            key={`${item.id}:${item.revision}:${item.selectionUpdatedAt}`}
            item={item}
            workspace={workspace}
          />
          <details className="mt-3 border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Quote and purchase-order links
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Import selections when creating an RFQ to retain their links. Link
              an existing purchase order below; this does not place or authorize
              an order.
            </p>
            <Link
              className="mt-2 inline-block text-sm text-primary underline"
              href={`/dashboard/projects/${encodeURIComponent(workspace.projectId)}/rfqs?quickAdd=rfq`}
            >
              Prepare supplier RFQ →
            </Link>
            <form
              className="mt-3 flex gap-2"
              onSubmit={handleSubmit((values) =>
                start(async () => {
                  setError(null)
                  const result = await linkSelectionPurchaseOrder(
                    workspace.projectId,
                    item.id,
                    values.operationId,
                  )
                  if (!result.success) setError(result.error)
                  else router.refresh()
                }),
              )}
            >
              <Controller
                control={control}
                name="operationId"
                rules={{ required: true }}
                render={({ field }) => (
                  <SearchableCombobox
                    className="h-9 min-w-0 flex-1 text-sm"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={workspace.purchaseOrders.map((po) => ({
                      value: po.id,
                      label: po.label,
                    }))}
                    ariaLabel={`Purchase order for ${spec.name}`}
                    placeholder="Choose a project purchase order"
                    searchPlaceholder="Search purchase orders..."
                    emptyMessage="No matching purchase orders."
                    required
                  />
                )}
              />
              {/* Linking needs a chosen purchase order. */}
              <Button size="sm" disabled={pending || chosenPurchaseOrder === ""}>
                Link PO
              </Button>
            </form>
          </details>
        </>
      )}
      {item.links.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {item.links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-2"
            >
              <a href={link.href} className="text-primary underline">
                {link.label} →
              </a>
              {!link.current && (
                <span className="text-xs text-destructive">
                  Specification changed
                </span>
              )}
              {staff && workspace.canWrite && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost">
                      Unlink
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Remove this selection link?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The quote or purchase order itself will remain. Removing
                        its link also removes this route for the supplier to see
                        the approved selection. An audit entry is retained.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          start(async () => {
                            const result = await unlinkSelectionProcurement(
                              workspace.projectId,
                              item.id,
                              link.id,
                            )
                            if (!result.success) setError(result.error)
                            else router.refresh()
                          })
                        }
                      >
                        Unlink
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </li>
          ))}
        </ul>
      )}
      {item.requests.length > 0 && (
        <div className="mt-4 space-y-4">
          <h3 className="text-xs font-semibold">Requests and responses</h3>
          {item.requests.map((request) => (
            <SelectionRequestCard
              key={`${request.id}:${request.updatedAt}`}
              projectId={workspace.projectId}
              item={item}
              request={request}
              staff={staff && workspace.canWrite}
            />
          ))}
        </div>
      )}
      {item.history.length > 0 && (
        <details className="mt-4 border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Approval history
          </summary>
          <ul className="mt-3 space-y-3 text-sm">
            {item.history.map((entry) => (
              <li key={`${entry.revision}:${entry.createdAt}`}>
                <p>
                  Revision {entry.revision} · {entry.actorName} ·{" "}
                  {new Date(entry.createdAt).toLocaleDateString("en-US")}
                </p>
                <p className="text-muted-foreground">
                  {[
                    entry.specification.name,
                    entry.specification.manufacturer,
                    entry.specification.model,
                    entry.specification.colorFinish,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {selectionMoney(entry.priceCents)} (allowance{" "}
                  {selectionMoney(entry.allowanceCents)})
                </p>
                <p className="text-muted-foreground">{entry.scheduleImpact}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  )
}

