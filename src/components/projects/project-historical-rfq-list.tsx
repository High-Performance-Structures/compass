import Link from "next/link"
import type * as React from "react"

import type {
  HistoricalRfqWorkspace,
  HistoricalRfqWorkspaceItem,
} from "@/lib/rfqs/historical-workspace"
import type { RfqHistoricalLine } from "@/lib/rfqs/historical-requests"

function formatCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100)
}

function submissionLabel(
  submission: "draft" | "submitted" | "other"
): string {
  if (submission === "draft") return "Draft capture"
  if (submission === "submitted") return "Submitted capture"
  return "Other source state"
}

function pricingLabel(
  pricing: "exact" | "unpriced" | "incomplete"
): string {
  if (pricing === "exact") return "Pricing reconciles exactly"
  if (pricing === "unpriced") return "No price supplied in source response"
  return "Pricing is incomplete"
}

function sourceAmountLabel(
  item: Extract<HistoricalRfqWorkspaceItem, { readonly kind: "request" }>
): string {
  if (item.sourceAmountDisplay !== null) {
    return `${item.sourceAmountDisplay} (${item.amountDisplayProvenance})`
  }
  return item.pricingReconciliation === "unpriced"
    ? "No price supplied in source response"
    : "Not captured"
}

function submittedAmountLabel(
  item: Extract<HistoricalRfqWorkspaceItem, { readonly kind: "request" }>
): string {
  if (item.submittedAmountCents !== null) {
    return formatCents(item.submittedAmountCents)
  }
  return item.pricingReconciliation === "unpriced"
    ? "No priced total in source response"
    : "Not captured"
}

function pageHref(
  projectId: string,
  statusFilter: string | undefined,
  historyAfter?: string
): string {
  const params: string[] = []
  if (statusFilter) params.push(`status=${encodeURIComponent(statusFilter)}`)
  if (historyAfter) params.push(`historyAfter=${encodeURIComponent(historyAfter)}`)
  const query = params.join("&")
  return `/dashboard/projects/${encodeURIComponent(projectId)}/rfqs${query ? `?${query}` : ""}#historical-rfq-history`
}

function groupRequests(
  items: readonly HistoricalRfqWorkspaceItem[]
): readonly {
  readonly bidPackageId: string
  readonly items: readonly HistoricalRfqWorkspaceItem[]
}[] {
  const groups = new Map<string, HistoricalRfqWorkspaceItem[]>()
  for (const item of items) {
    // A payload hold does not discard an independently scoped package identity.
    const bidPackageId = item.bidPackageId ?? "held"
    const group = groups.get(bidPackageId)
    if (group) {
      group.push(item)
    } else {
      groups.set(bidPackageId, [item])
    }
  }

  return Array.from(groups, ([bidPackageId, groupItems]) => ({
    bidPackageId,
    items: groupItems,
  }))
}

function HistoricalLineTable({
  lines,
}: {
  readonly lines: readonly RfqHistoricalLine[]
}): React.ReactElement {
  return (
    <div className="mt-4 overflow-x-auto border-t">
      <table className="w-full min-w-[60rem] text-left text-xs">
        <caption className="sr-only">Captured historical RFQ line items</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="px-2 py-2 font-medium">Line</th>
            <th className="px-2 py-2 font-medium">Title</th>
            <th className="px-2 py-2 font-medium">Description</th>
            <th className="px-2 py-2 font-medium">Expanded description</th>
            <th className="px-2 py-2 font-medium">Cost code</th>
            <th className="px-2 py-2 font-medium">Cost type</th>
            <th className="px-2 py-2 font-medium">Unit cost</th>
            <th className="px-2 py-2 font-medium">Quantity</th>
            <th className="px-2 py-2 font-medium">Unit</th>
            <th className="px-2 py-2 font-medium">Builder cost</th>
            <th className="px-2 py-2 font-medium">Submitted amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.lineNumber} className="border-b align-top last:border-b-0">
              <td className="px-2 py-2 font-medium">{line.lineNumber}</td>
              <td className="px-2 py-2">{line.title ?? "-"}</td>
              <td className="px-2 py-2">{line.description ?? "-"}</td>
              <td className="px-2 py-2">{line.expandedDescription ?? "-"}</td>
              <td className="px-2 py-2">{line.costCodeDisplay ?? "-"}</td>
              <td className="px-2 py-2">{line.costTypeDisplay ?? "-"}</td>
              <td className="px-2 py-2">{line.unitCostDisplay ?? "-"}</td>
              <td className="px-2 py-2">{line.quantityDisplay ?? "-"}</td>
              <td className="px-2 py-2">{line.unitDisplay ?? "-"}</td>
              <td className="px-2 py-2">{line.builderCostDisplay ?? "-"}</td>
              <td className="px-2 py-2">
                {line.submittedLineAmountCents === null
                  ? "-"
                  : formatCents(line.submittedLineAmountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RequestItem({
  item,
}: {
  readonly item: Extract<HistoricalRfqWorkspaceItem, { readonly kind: "request" }>
}): React.ReactElement {
  return (
    <details className="border-t py-4">
      <summary className="cursor-pointer list-inside text-sm font-medium">
        <span>{item.vendorDisplay}</span>
        <span className="ml-2 font-normal text-muted-foreground">
          {submissionLabel(item.submission)} · {item.sourceStatus} · historical evidence
        </span>
      </summary>

      <div className="mt-3 grid gap-3 text-sm">
        <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
          <p>
            <span className="font-medium text-foreground">Vendor:</span>{" "}
            {item.vendorDisplay}
          </p>
          <p>
            <span className="font-medium text-foreground">Source status:</span>{" "}
            {item.sourceStatus}
          </p>
          <p>
            <span className="font-medium text-foreground">Released (source display):</span>{" "}
            {item.releasedDisplay ?? "Not captured"}
          </p>
          <p>
            <span className="font-medium text-foreground">Submitted (source display):</span>{" "}
            {item.submittedDisplay ?? "Not captured"}
          </p>
          <p>
            <span className="font-medium text-foreground">Submitted by (source display):</span>{" "}
            {item.submittedByDisplay ?? "Not captured separately"}
          </p>
          <p>
            <span className="font-medium text-foreground">Source amount:</span>{" "}
            {sourceAmountLabel(item)}
          </p>
          <p>
            <span className="font-medium text-foreground">Pricing:</span>{" "}
            {pricingLabel(item.pricingReconciliation)}
          </p>
          <p>
            <span className="font-medium text-foreground">Submitted total:</span>{" "}
            {submittedAmountLabel(item)}
          </p>
          <p>
            <span className="font-medium text-foreground">Source record:</span>{" "}
            {item.sourceRecordId}
          </p>
        </div>

        <div className="border-t pt-3">
          <p className="font-medium">Source vendor notes</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {item.vendorNotes ?? "Not captured"}
          </p>
        </div>

        {item.holds.length > 0 && (
          <div className="border-l-2 border-brand-nutech-gold px-3 py-2 text-sm">
            <p className="font-medium">Evidence held for review</p>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {item.holds.map((hold) => (
                <li key={hold}>{hold}</li>
              ))}
            </ul>
          </div>
        )}

        {item.lines.length > 0 && <HistoricalLineTable lines={item.lines} />}

        {item.attachments.length > 0 && (
          <div className="border-t pt-3">
            <p className="font-medium">Captured files</p>
            <ul className="mt-2 grid gap-2 text-sm">
              {item.attachments.map((attachment) => (
                <li key={attachment.documentInstanceId}>
                  {attachment.status === "verified" ? (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {attachment.label}
                    </a>
                  ) : (
                    <span>
                      {attachment.label} ({attachment.reason}; link withheld)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

function HeldItem({
  item,
}: {
  readonly item: Extract<HistoricalRfqWorkspaceItem, { readonly kind: "held" }>
}): React.ReactElement {
  return (
    <div className="border-t py-4 text-sm">
      <p className="font-medium">Historical response held from display</p>
      <p className="mt-1 text-muted-foreground">
        Source record {item.sourceRecordId}: {item.reason}
      </p>
    </div>
  )
}

export function ProjectHistoricalRfqList({
  workspace,
  statusFilter,
}: {
  readonly workspace: HistoricalRfqWorkspace
  readonly statusFilter?: string
}): React.ReactElement {
  return (
    <section id="historical-rfq-history" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Historical RFQ responses</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Captured submissions are historical evidence, not a new Compass approval.
        </p>
      </div>

      {!workspace.success ? (
        <div className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
          {workspace.error}
        </div>
      ) : workspace.items.length === 0 ? (
        <div className="border-t py-4 text-sm text-muted-foreground">
          <p>
            {workspace.totalRecords > 0
              ? "No historical responses on this page."
              : "No historical responses captured."}
          </p>
          {workspace.totalRecords > 0 && (
            <Link
              href={pageHref(workspace.projectId, statusFilter)}
              className="mt-2 inline-flex font-medium text-primary underline-offset-4 hover:underline"
            >
              First historical responses
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {workspace.totalRecords} captured source record
            {workspace.totalRecords === 1 ? "" : "s"}. Drafts and incomplete responses remain visible.
          </div>
          <div className="border-y">
            {groupRequests(workspace.items).map((group) => (
              <section key={group.bidPackageId} className="px-3 first:border-t-0">
                <h3 className="border-t py-3 text-sm font-semibold">
                  Bid package {group.bidPackageId === "held" ? "held source records" : group.bidPackageId}
                </h3>
                {group.items.map((item) =>
                  item.kind === "request" ? (
                    <RequestItem
                      key={`${item.sourceRecordId}-${item.requestId}`}
                      item={item}
                    />
                  ) : (
                    <HeldItem key={item.sourceRecordId} item={item} />
                  )
                )}
              </section>
            ))}
          </div>
          <nav aria-label="Historical RFQ response pages" className="flex flex-wrap gap-4">
            {workspace.hasPreviousPage && (
              <Link
                href={pageHref(workspace.projectId, statusFilter)}
                className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                First historical responses
              </Link>
            )}
            {workspace.nextCursor && (
              <Link
                href={pageHref(workspace.projectId, statusFilter, workspace.nextCursor)}
                className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Next historical responses
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  )
}
