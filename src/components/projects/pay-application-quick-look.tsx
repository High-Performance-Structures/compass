"use client"

/**
 * A pay application's Quick look, shown in the record drawer from the job's
 * financial queue: status, the four G702 totals, billing approval and the Sage
 * invoice number. The G703 line grid needs the full page (Edit).
 */

import * as React from "react"
import { IconEye } from "@tabler/icons-react"

import type { ProjectOwnerPayApplicationDraft } from "@/app/actions/project-financial-workflows"
import { PayApplicationBillingControls, payApplicationStatusLabel } from "@/components/projects/pay-application-billing-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"

export function PayApplicationQuickLook({
  projectId,
  application,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
}): React.ReactElement {
  const [message, setMessage] = React.useState<string | null>(null)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{payApplicationStatusLabel(application.status)}</Badge>
        <span className="text-sm text-muted-foreground">Period to {application.periodTo ?? "not set"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild>
          <a href={`/print/projects/${projectId}/pay-application?applicationId=${application.id}`} target="_blank" rel="noopener">
            <IconEye className="size-4" />
            Print Preview
          </a>
        </Button>
        <PayApplicationBillingControls projectId={projectId} application={application} onMessage={setMessage} />
      </div>
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
        {[
          ["Contract to date", application.contractSumToDate],
          ["Completed + stored", application.totalCompletedStoredToDate],
          ["Current payment due", application.currentPaymentDue],
          ["Balance to finish", application.balanceToFinish],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(Number(value))}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Billing lines, deposits and the Sage checks are on the full page.
      </p>
    </div>
  )
}
