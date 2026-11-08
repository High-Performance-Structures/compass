import { IconAlertTriangle, IconCircleCheck, IconClock } from "@tabler/icons-react"

import { PrintPreviewButton } from "@/components/print/print-preview-button"
import type { SageBillingCheckView } from "@/lib/financials/sage-billing-check"
import type { Taxability } from "@/lib/domain/budget/sage-billing-check-rules"
import { formatCents, formatDate, formatDateTime, toCents } from "@/lib/format"
import { cn } from "@/lib/utils"

/*
 * Pay requests built in Sage: the "Enter in Sage" checklist (what to type in
 * Sage's progress billing before posting) and the Sage check of the AR
 * invoice posting created. The document part is shared with Print Preview.
 */

const SAGE_STATUS: Readonly<Record<string, string>> = { "1": "Open", "2": "Submitted", "3": "Posted", "4": "Posted" }

function sageStatusLabel(status: string): string {
  return SAGE_STATUS[status] ?? `Status ${status}`
}

const TAXABILITY: Readonly<Record<Taxability, string>> = { taxable: "Taxable", not_taxable: "Not taxable", split: "Split: taxable + non-taxable" }

const PLACEMENT = { on_billing: "On the billing", add_line: "Add as its own line", append_new_line: "Append as new line" } as const

function Row({ label, value }: { readonly label: string; readonly value: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex justify-between gap-4 border-b py-1 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** The checklist itself: header values, lines, change orders, shop tickets and totals. */
export function SageBillingChecklistDocument({ view }: { readonly view: SageBillingCheckView }): React.ReactElement {
  const { checklist } = view
  const district = checklist.taxDistrict
  return (
    <div className="space-y-4 text-sm">
      {checklist.warnings.length > 0 ? (
        <ul className="space-y-1 border-l-2 border-destructive pl-3 text-destructive">
          {checklist.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <dl className="grid max-w-3xl gap-x-8 md:grid-cols-2">
        <Row label="Invoice number (when Sage asks at posting)" value={checklist.invoiceNumber.value || "—"} />
        <Row label="Description" value={checklist.description || "—"} />
        <Row label="Billing date" value={checklist.billingDate ? formatDate(checklist.billingDate) : "—"} />
        <Row label="Period" value={checklist.periodTo ? formatDate(checklist.periodTo) : "—"} />
        <Row label="Billing cycle" value={checklist.billingCycle} />
        <Row
          label="Tax district"
          value={district ? `${district.code} ${district.name} ${(district.rateBasisPoints / 100).toFixed(2)}%` : "None on the estimate"}
        />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <caption className="pb-1 text-left text-xs font-semibold uppercase text-muted-foreground">Lines: mark Taxable as shown</caption>
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 text-left font-medium">Cost code</th>
              <th className="py-1.5 text-left font-medium">Description</th>
              <th className="py-1.5 text-left font-medium">Taxable</th>
              <th className="py-1.5 text-right font-medium">This period</th>
              <th className="py-1.5 text-right font-medium">Taxable amount</th>
              <th className="py-1.5 text-left font-medium">In Sage now</th>
            </tr>
          </thead>
          <tbody>
            {checklist.lines.map((line) => (
              <tr key={line.key} className={cn("border-b", line.flagDiffers && "bg-muted/35")}>
                <td className="py-1">{line.costCode}</td>
                <td className="py-1">{line.description}</td>
                <td className={cn("py-1", line.expected !== "not_taxable" && "font-semibold")}>{TAXABILITY[line.expected]}</td>
                <td className="py-1 text-right tabular-nums">{formatCents(line.thisPeriodCents)}</td>
                <td className="py-1 text-right tabular-nums">{line.taxableCents ? formatCents(line.taxableCents) : "—"}</td>
                <td className={cn("py-1", line.flagDiffers && "font-semibold text-destructive")}>
                  {line.sageTaxable === null ? "—" : line.sageTaxable ? "Taxable" : "Not taxable"}
                  {line.flagDiffers ? " · change" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {checklist.changeOrders.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <caption className="pb-1 text-left text-xs font-semibold uppercase text-muted-foreground">
              Change orders and variances: each on its own line
            </caption>
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-left font-medium">Change</th>
                <th className="py-1.5 text-left font-medium">Cost code</th>
                <th className="py-1.5 text-left font-medium">Taxable</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
                <th className="py-1.5 text-left font-medium">In Sage</th>
              </tr>
            </thead>
            <tbody>
              {checklist.changeOrders.map((part) => (
                <tr key={part.key} className="border-b">
                  <td className="py-1">{part.label}</td>
                  <td className="py-1">
                    {part.costCode} <span className="text-muted-foreground">{part.description}</span>
                  </td>
                  <td className="py-1">{TAXABILITY[part.taxability]}</td>
                  <td className="py-1 text-right tabular-nums">{formatCents(part.amountCents)}</td>
                  <td className={cn("py-1", part.placement !== "on_billing" && "font-semibold")}>{PLACEMENT[part.placement]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {view.unbilledShopTickets.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Unbilled shop tickets to add</p>
          <ul className="mt-1 space-y-0.5">
            {view.unbilledShopTickets.map((ticket) => (
              <li key={ticket.ticketNumber} className="flex max-w-md justify-between gap-4">
                <span>
                  {ticket.ticketNumber} · {formatDate(ticket.ticketDate)}
                </span>
                <span className="tabular-nums">{formatCents(ticket.totalCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="max-w-md">
        <Row label="This period (work + stored)" value={formatCents(checklist.totals.thisPeriodCents)} />
        <Row label="Retention this period" value={formatCents(checklist.totals.retentionCents)} />
        <Row label="Current payment due" value={formatCents(checklist.totals.amountDueCents)} />
        <Row label="Expected sales tax" value={formatCents(checklist.totals.expectedTaxCents)} />
        <Row label="Expected invoice total" value={formatCents(checklist.totals.expectedInvoiceTotalCents)} />
      </dl>
    </div>
  )
}

/** The Sage check: Matches Sage / Needs attention / Not posted yet, with the posted invoice. */
function SageCheckResult({ view }: { readonly view: SageBillingCheckView }): React.ReactElement {
  const { check, sage } = view
  const invoice = sage?.invoice ?? null
  const heading =
    check.status === "matches"
      ? { icon: <IconCircleCheck className="size-4 text-primary" />, text: "Matches Sage" }
      : check.status === "needs_attention"
        ? { icon: <IconAlertTriangle className="size-4 text-destructive" />, text: "Needs attention" }
        : check.status === "unavailable"
          ? { icon: <IconClock className="size-4 text-muted-foreground" />, text: "Posted; update the Sage poller to check the invoice" }
          : { icon: <IconClock className="size-4 text-muted-foreground" />, text: "Not posted yet" }
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        {heading.icon}
        {heading.text}
        {sage ? (
          <span className="font-normal text-muted-foreground">
            Sage billing {sageStatusLabel(sage.status)} · synced {formatDateTime(sage.capturedAt)}
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">Not synced from Sage yet</span>
        )}
      </p>
      {check.findings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {check.findings.map((finding) => (
            <li key={finding.key}>{finding.message}</li>
          ))}
        </ul>
      ) : null}
      {invoice ? (
        <dl className="grid max-w-3xl gap-x-8 md:grid-cols-2">
          <Row label="Sage invoice" value={invoice.invoiceNumber ?? "—"} />
          <Row label="Invoice date" value={invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "—"} />
          <Row label="Tax district" value={invoice.taxDistrict ? (invoice.taxDistrict.name ?? invoice.taxDistrict.code) : "None"} />
          <Row label="Taxable / non-taxable" value={`${formatCents(toCents(invoice.taxableAmount))} / ${formatCents(toCents(invoice.nonTaxableAmount))}`} />
          <Row label="Sales tax" value={formatCents(toCents(invoice.salesTax))} />
          <Row label="Retention" value={formatCents(toCents(invoice.retention))} />
          <Row label="Invoice total" value={formatCents(toCents(invoice.total))} />
          <Row label="Invoice lines" value={invoice.lines.length} />
        </dl>
      ) : null}
    </div>
  )
}

/** The pay request page's "Enter in Sage" section, for companies whose pay requests are created in Sage. */
export function SageBillingCheckSection({
  projectId,
  applicationId,
  view,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly view: SageBillingCheckView
}): React.ReactElement {
  return (
    <section aria-labelledby={`sage-billing-check-${applicationId}`} className="mt-6 space-y-4 border-y p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`sage-billing-check-${applicationId}`} className="text-base font-semibold">
            Enter in Sage
          </h2>
          <p className="text-sm text-muted-foreground">
            What to enter in Sage&apos;s progress billing before you post it, and the check of the invoice Sage creates.
          </p>
        </div>
        <PrintPreviewButton
          link={{ projectId, document: "sage-billing-checklist", params: { applicationId }, number: `Enter in Sage ${view.applicationNumber}` }}
        />
      </div>
      <SageCheckResult view={view} />
      <details open={view.check.status === "not_posted"}>
        <summary className="cursor-pointer text-sm font-semibold">Checklist</summary>
        <div className="mt-3">
          <SageBillingChecklistDocument view={view} />
        </div>
      </details>
    </section>
  )
}
