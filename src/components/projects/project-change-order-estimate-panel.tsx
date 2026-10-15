"use client"

import * as React from "react"
import Link from "next/link"
import { IconCalculator, IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"

import type { ProjectChangeOrderEstimateOption } from "@/app/actions/project-change-orders"
import { createChangeOrderEstimateDraft } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: "Draft",
  internal_review: "Internal review",
  signature_pending: "Waiting for signature",
  accepted: "Accepted",
  superseded: "Superseded",
  void: "Void",
}

/**
 * The change order's own estimate: built, previewed, printed and signed like
 * the contract estimate. Accepting it executes the change order and adds its
 * priced cost codes to the budget.
 */
export function ProjectChangeOrderEstimatePanel({
  projectId,
  changeOrderId,
  estimate,
  canStart,
}: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly estimate: ProjectChangeOrderEstimateOption | null
  readonly canStart: boolean
}): React.ReactElement {
  const [pending, startTransition] = React.useTransition()
  const estimateHref = (id: string): string =>
    `/dashboard/projects/${encodeURIComponent(projectId)}/estimate?estimateId=${encodeURIComponent(id)}`

  function start(): void {
    startTransition(async () => {
      const result = await createChangeOrderEstimateDraft(projectId, changeOrderId)
      if (!result.success || !result.id) {
        toast.error(result.success ? "Unable to start the estimate." : result.error)
        return
      }
      // Full navigation: the estimate page loads the new draft fresh.
      window.location.assign(estimateHref(result.id))
    })
  }

  return (
    <div className="border-y bg-background p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <IconCalculator className="size-4 text-muted-foreground" />
        Change-order estimate
      </h2>
      {estimate ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm">
            {estimate.estimateNumber} v{estimate.versionNumber} · {STATUS_LABEL[estimate.status] ?? estimate.status} ·{" "}
            <span className="tabular-nums">{money(estimate.estimateTotalCents)}</span>
          </p>
          <Link
            href={estimateHref(estimate.id)}
            className="flex items-center justify-between gap-3 border px-3 py-2 text-sm hover:bg-muted"
          >
            Open the change-order estimate
            <IconExternalLink className="size-4 shrink-0" />
          </Link>
          <p className="text-xs text-muted-foreground">
            Build, preview, print and send it for signature like the contract estimate. Accepting it executes this change order
            and adds its priced cost codes to the budget.
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            Price this change with a full estimate (lines, assemblies, client report and signature), the same way as the contract
            estimate. Accepting it executes the change order and updates the budget.
          </p>
          {canStart ? (
            <Button type="button" size="sm" disabled={pending} onClick={start}>
              {pending ? "Starting…" : "Build change-order estimate"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
