"use client"

import * as React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
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
function DecisionCard({
  item,
  workspace,
}: {
  readonly item: SelectionDecisionItem
  readonly workspace: SelectionWorkspace
}): React.ReactElement {
  const router = useRouter(),
    [requestOpen, setRequestOpen] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [pending, start] = React.useTransition()
  const { register, handleSubmit } = useForm<{ operationId: string }>({
    defaultValues: { operationId: "" },
  })
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
        item.revision
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {spec.roomName} · {spec.category}
          </p>
          <h2 className="mt-1 font-semibold">{spec.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {item.decisionDueDate
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
        <span>Progress: {item.status.replaceAll("_", " ")}</span>
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
                    values.operationId
                  )
                  if (!result.success) setError(result.error)
                  else router.refresh()
                })
              )}
            >
              <select
                aria-label={`Purchase order for ${spec.name}`}
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                {...register("operationId", { required: true })}
                required
              >
                <option value="">Choose a project purchase order</option>
                {workspace.purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.label}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={pending}>
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
                              link.id
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

function StaffDecisionRow({
  item,
  workspace,
}: {
  readonly item: SelectionDecisionItem
  readonly workspace: SelectionWorkspace
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const pendingRequests = item.requests.filter(
    (request) => request.status === "open"
  ).length
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Close" : "Review"} ${item.currentSpec.roomName}: ${item.currentSpec.name}`}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center justify-between gap-2 py-4 text-left text-sm"
      >
        <span>
          <span className="text-muted-foreground">
            {item.currentSpec.roomName} ·{" "}
          </span>
          <span className="font-medium">{item.currentSpec.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {pendingRequests > 0 ? `${pendingRequests} owner requests · ` : ""}
          {!item.published
            ? "Unpublished"
            : !item.current
              ? "Revision needed"
              : item.approvedAt
                ? "Owner approved"
                : "Published for owner"}{" "}
          · {open ? "Close ↑" : "Review ↓"}
        </span>
      </button>
      {open && <DecisionCard item={item} workspace={workspace} />}
    </div>
  )
}

export function SelectionDecisionWorkspace({
  workspace,
}: {
  readonly workspace: SelectionWorkspace
}): React.ReactElement {
  const [room, setRoom] = React.useState(""),
    [pendingOnly, setPendingOnly] = React.useState(false),
    [search, setSearch] = React.useState("")
  const items = workspace.items.filter(
    (item) =>
      (!room ||
        (workspace.audience === "staff" ? item.currentSpec : item.spec)
          .roomName === room) &&
      (!search.trim() ||
        [
          item.currentSpec.roomName,
          item.currentSpec.name,
          item.currentSpec.manufacturer,
          item.currentSpec.model,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase())) &&
      (!pendingOnly ||
        !item.approvedAt ||
        !item.current ||
        item.requests.some((request) => request.status === "open"))
  )
  return (
    <section aria-label="Selections and decisions" className="min-w-0">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">
          {workspace.audience === "sub_vendor"
            ? "Approved selections"
            : "Selections & Decisions"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {workspace.audience === "staff"
            ? "Publish owner-ready specifications and pricing, resolve requests, and connect approved choices to procurement."
            : workspace.audience === "owner"
              ? "Choose the details that make this home yours. Review choices by room, request pricing, and approve the exact specification and terms."
              : "The current approved specifications connected to your project quotes and commitments."}
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Find a selection
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-44 rounded-md border bg-background px-2"
            placeholder="Product or room"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Room
          <select
            className="h-9 rounded-md border bg-background px-2"
            aria-label="Room"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          >
            <option value="">All rooms</option>
            {[
              ...new Set(
                workspace.items.map(
                  (item) =>
                    (workspace.audience === "staff"
                      ? item.currentSpec
                      : item.spec
                    ).roomName
                )
              ),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {workspace.audience !== "sub_vendor" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(event) => setPendingOnly(event.target.checked)}
            />
            Needs a decision or response
          </label>
        )}
        <span className="text-xs text-muted-foreground">
          {items.length} selections
        </span>
      </div>
      {items.length === 0 ? (
        <p className="border-t py-8 text-sm text-muted-foreground">
          {workspace.items.length > 0
            ? "No selections match these filters."
            : workspace.audience === "staff"
              ? "Add a finish selection below, then publish it here for the owner."
              : workspace.audience === "owner"
                ? "Your team will publish room-by-room selections here when they are ready for your input."
                : "No approved selections have been shared with your quotes or commitments yet."}
        </p>
      ) : (
        items.map((item) =>
          workspace.audience === "staff" ? (
            <StaffDecisionRow key={item.id} item={item} workspace={workspace} />
          ) : (
            <DecisionCard
              key={`${item.id}:${item.revision}`}
              item={item}
              workspace={workspace}
            />
          )
        )
      )}
    </section>
  )
}
