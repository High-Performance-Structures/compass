import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import type { SageExportPreview } from "@/lib/financials/sage-export-preview-server"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/*
 * The Sage export preview document: what Compass would send to Sage for an
 * owner pay application, with every mismatch shown. Shared by the pay
 * application page and its Print Preview. Read only.
 */

const cell = "border-b px-2 py-1 align-top"
const num = `${cell} text-right tabular-nums`
const head = "border-b px-2 py-1 text-left font-medium text-muted-foreground print:text-report-ink"
const headNum = `${head} text-right`

function Money({ cents, flag = false }: { readonly cents: number; readonly flag?: boolean }): React.ReactElement {
  return <span className={cn(flag && cents !== 0 && "font-semibold text-destructive")}>{formatCents(cents)}</span>
}

function SageCode({ mapping }: { readonly mapping: SageCostCodeMapping }): React.ReactElement {
  if (mapping.status === "unmapped") {
    return (
      <span className="text-destructive">
        <IconAlertTriangle className="mr-1 inline size-3.5" aria-hidden />
        Unmapped: {mapping.reason}
      </span>
    )
  }
  return (
    <span>
      {mapping.sageName}
      {mapping.sageRecordNumber ? <span className="text-muted-foreground"> (#{mapping.sageRecordNumber})</span> : null}
    </span>
  )
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

function Header({ preview }: { readonly preview: SageExportPreview }): React.ReactElement {
  const { header } = preview
  return (
    <section aria-labelledby="sage-export-header" className="space-y-2">
      <h3 id="sage-export-header" className="text-sm font-semibold">Progress billing header</h3>
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Field label="Sage job">
          {header.sageJobNumber ?? <span className="text-destructive">Not linked to a Sage job</span>}
        </Field>
        <Field label="Application number">{header.applicationSequence}</Field>
        <Field label="Billing date (period to)">{formatDate(header.periodTo)}</Field>
        <Field label="Sage period">{header.sagePeriod ?? <span className="text-destructive">No period date</span>}</Field>
        <Field label="Billing cycle">{header.billingCycle}</Field>
        <Field label="Description">{header.description ?? <span className="text-destructive">Set the period-to date</span>}</Field>
        <Field label="Suggested invoice number">
          <span className={cn(header.invoiceNumber.error && "text-destructive")}>{header.invoiceNumber.value || "-"}</span>
          {header.invoiceNumber.error ? <span className="block text-xs text-destructive">{header.invoiceNumber.error}</span> : null}
        </Field>
        <Field label="Sage invoice number recorded">{header.recordedSageInvoiceNumber ?? "Not yet"}</Field>
      </dl>
    </section>
  )
}

function Lines({ preview }: { readonly preview: SageExportPreview }): React.ReactElement {
  const totals = preview.lines.reduce(
    (sum, line) => ({
      scheduled: sum.scheduled + line.scheduledCents,
      changeOrders: sum.changeOrders + line.changeOrderCents,
      variances: sum.variances + line.varianceCents,
      previous: sum.previous + line.previousCents,
      current: sum.current + line.currentCents,
      stored: sum.stored + line.storedCents,
      completed: sum.completed + line.completedToDateCents,
    }),
    { scheduled: 0, changeOrders: 0, variances: 0, previous: 0, current: 0, stored: 0, completed: 0 }
  )
  return (
    <section aria-labelledby="sage-export-lines" className="space-y-2">
      <h3 id="sage-export-lines" className="text-sm font-semibold">
        Lines, one per cost code
        {preview.unmappedCount > 0 ? (
          <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive">{preview.unmappedCount} unmapped</Badge>
        ) : null}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] border-collapse text-xs">
          <thead>
            <tr>
              <th className={head}>Compass cost code</th>
              <th className={head}>Sage cost code</th>
              <th className={headNum}>Scheduled value</th>
              <th className={headNum}>Change orders</th>
              <th className={headNum}>Variances</th>
              <th className={headNum}>Previous completed</th>
              <th className={headNum}>This period</th>
              <th className={headNum}>Stored</th>
              <th className={headNum}>Completed to date</th>
              <th className={head}>In Sage</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((line) => (
              <tr key={line.key}>
                <td className={cell}>{line.costCode} <span className="text-muted-foreground">{line.description}</span></td>
                <td className={cell}><SageCode mapping={line.mapping} /></td>
                <td className={num}><Money cents={line.scheduledCents} /></td>
                <td className={num}><Money cents={line.changeOrderCents} /></td>
                <td className={num}><Money cents={line.varianceCents} /></td>
                <td className={num}><Money cents={line.previousCents} /></td>
                <td className={num}><Money cents={line.currentCents} /></td>
                <td className={num}><Money cents={line.storedCents} /></td>
                <td className={num}><Money cents={line.completedToDateCents} /></td>
                <td className={cell}>
                  {line.newToSage === null ? "Unknown" : line.newToSage ? <span className="font-medium text-warning">New: Append as new line</span> : "On Sage billing"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={cell} colSpan={2}>Total</td>
              <td className={num}><Money cents={totals.scheduled} /></td>
              <td className={num}><Money cents={totals.changeOrders} /></td>
              <td className={num}><Money cents={totals.variances} /></td>
              <td className={num}><Money cents={totals.previous} /></td>
              <td className={num}><Money cents={totals.current} /></td>
              <td className={num}><Money cents={totals.stored} /></td>
              <td className={num}><Money cents={totals.completed} /></td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function Reconciliation({ preview }: { readonly preview: SageExportPreview }): React.ReactElement {
  const result = preview.reconciliation
  if (!result.available) {
    return (
      <section aria-labelledby="sage-export-reconcile" className="space-y-2">
        <h3 id="sage-export-reconcile" className="text-sm font-semibold">Compared with Sage</h3>
        <p className="text-sm text-warning">Sage comparison unavailable. {result.reason}</p>
      </section>
    )
  }
  const mismatches = result.lines.filter((line) => line.mismatch)
  return (
    <section aria-labelledby="sage-export-reconcile" className="space-y-2">
      <h3 id="sage-export-reconcile" className="text-sm font-semibold">
        Compared with Sage application {result.sageApplication.applicationNumber}
        <span className="font-normal text-muted-foreground">
          {" "}(period to {formatDate(result.sageApplication.periodTo)}, read from Sage {formatDateTime(result.sageApplication.capturedAt)})
        </span>
      </h3>
      {preview.sageAlreadyHasThisApplication ? (
        <p className="text-sm text-warning">
          Sage&apos;s latest application is already number {result.sageApplication.applicationNumber}, so it may already include this draw. Check before entering it.
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <Field label="Contract to date: Compass / Sage / difference">
          <Money cents={result.contractToDate.compassCents} /> / <Money cents={result.contractToDate.sageCents} /> /{" "}
          <Money cents={result.contractToDate.differenceCents} flag />
        </Field>
        <Field label="Completed to date: Compass previous / Sage / difference">
          <Money cents={result.completedToDate.compassCents} /> / <Money cents={result.completedToDate.sageCents} /> /{" "}
          <Money cents={result.completedToDate.differenceCents} flag />
        </Field>
      </dl>
      {mismatches.length === 0 ? (
        <p className="text-sm text-success">Every cost code matches Sage&apos;s last application.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-xs">
            <thead>
              <tr>
                <th className={head}>Cost code</th>
                <th className={headNum}>Compass contract</th>
                <th className={headNum}>Sage contract</th>
                <th className={headNum}>Difference</th>
                <th className={headNum}>Compass previous</th>
                <th className={headNum}>Sage completed</th>
                <th className={headNum}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((line) => (
                <tr key={line.key}>
                  <td className={cell}>
                    {line.label}
                    {line.presence === "sage_only" ? <span className="block text-destructive">Only on Sage&apos;s billing</span> : null}
                    {line.presence === "compass_only" ? <span className="block text-warning">Not on Sage&apos;s billing yet</span> : null}
                  </td>
                  <td className={num}><Money cents={line.compassContractCents} /></td>
                  <td className={num}><Money cents={line.sageContractCents} /></td>
                  <td className={num}><Money cents={line.contractDifferenceCents} flag /></td>
                  <td className={num}><Money cents={line.compassPreviousCents} /></td>
                  <td className={num}><Money cents={line.sageCompletedCents} /></td>
                  <td className={num}><Money cents={line.previousDifferenceCents} flag /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Contract differences are expected for change orders and variances executed since Sage&apos;s last application until they are entered in Sage (see below). Previous-completed differences mean Compass and Sage disagree about what was billed before.
      </p>
    </section>
  )
}

const IN_SAGE_LABELS: Record<SageExportPreview["changeOrders"][number]["inSage"], string> = {
  linked: "Linked",
  in_sage: "In Sage",
  not_in_sage: "Not in Sage",
  differs: "Differs",
  unknown: "Unknown",
}

function ChangeOrders({ preview }: { readonly preview: SageExportPreview }): React.ReactElement {
  return (
    <section aria-labelledby="sage-export-change-orders" className="space-y-2">
      <h3 id="sage-export-change-orders" className="text-sm font-semibold">Change orders and variances Sage needs first</h3>
      {preview.changeOrders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No executed change orders or variances in this draw&apos;s contract budget.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-xs">
            <thead>
              <tr>
                <th className={head}>Sage name</th>
                <th className={head}>Executed</th>
                <th className={head}>Sage period</th>
                <th className={head}>Lines (Sage cost code)</th>
                <th className={headNum}>Amount</th>
                <th className={head}>In Sage</th>
              </tr>
            </thead>
            <tbody>
              {preview.changeOrders.map((changeOrder) => (
                <tr key={changeOrder.id}>
                  <td className={cell}>
                    <span className="font-medium">{changeOrder.sageName}</span> <span className="text-muted-foreground">{changeOrder.title}</span>
                  </td>
                  <td className={cell}>{formatDate(changeOrder.executedAt)}</td>
                  <td className={cell}>{changeOrder.period ? `${changeOrder.period.period} (${changeOrder.period.month} ${changeOrder.period.year})` : "-"}</td>
                  <td className={cell}>
                    <ul className="space-y-0.5">
                      {changeOrder.lines.map((line) => (
                        <li key={line.costCode}>
                          <SageCode mapping={line.mapping} />: {formatCents(line.amountCents)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={num}><Money cents={changeOrder.amountCents} /></td>
                  <td className={cell}>{IN_SAGE_LABELS[changeOrder.inSage]}{changeOrder.sageNumber ? ` (${changeOrder.sageNumber})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        &quot;Unknown&quot; means Compass hasn&apos;t read this job&apos;s change orders from Sage yet; check Sage for each before entering the pay request. Office staff send approved change orders to Sage from the project&apos;s Financials page or the change order itself.
      </p>
    </section>
  )
}

export function SageExportPreviewDocument({ preview }: { readonly preview: SageExportPreview }): React.ReactElement {
  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>
          Preview only: nothing here is sent to Sage. Posting in Sage stays manual; when the export is built it will stop at Submitted, and staff post it in Sage.
        </span>
      </p>
      <Header preview={preview} />
      <Lines preview={preview} />
      <Reconciliation preview={preview} />
      <ChangeOrders preview={preview} />
    </div>
  )
}
