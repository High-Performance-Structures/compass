import type * as React from "react"

import type { ProjectOwnerPayApplicationReport } from "@/app/actions/project-financial-workflows"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import {
  payApplicationChangeOrderSummary,
  payApplicationReport,
  type PayApplicationReportAmounts,
} from "@/lib/financials/pay-application-report"
import type { ProjectBrand } from "@/lib/project-branding"

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const money = (value: number): string => currency.format(value)
const percentText = (value: number): string => `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`

function longDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

const G703_COLUMNS: readonly { readonly key: keyof PayApplicationReportAmounts; readonly label: string }[] = [
  { key: "originalContractSum", label: "Original contract sum" },
  { key: "priorChanges", label: "Prior changes" },
  { key: "currentChanges", label: "Current changes" },
  { key: "adjustedEstimate", label: "Adjusted estimate" },
  { key: "priorCosts", label: "Prior costs" },
  { key: "currentCosts", label: "Current costs" },
  { key: "completedToDate", label: "Completed to date" },
  { key: "percentComplete", label: "%" },
  { key: "balance", label: "Balance" },
]
const COLUMN_LETTERS = "BCDEFGHIJ"

function amountCells(amounts: PayApplicationReportAmounts): React.ReactElement[] {
  return G703_COLUMNS.map((column) => (
    <td key={column.key} className="num">
      {column.key === "percentComplete" ? percentText(amounts.percentComplete) : money(amounts[column.key])}
    </td>
  ))
}

function SignatureLine({ left, right }: { readonly left: string; readonly right: string }): React.ReactElement {
  return (
    <div className="pay-app-signature">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )
}

/**
 * The client pay application: a landscape G702 application and certificate
 * with contractor and reviewer sign-offs, then the G703 continuation sheet at
 * the detail chosen for the client.
 */
export function PayApplicationClientReport({
  projectId,
  report,
  brand,
  showActions,
}: {
  readonly projectId: string
  readonly report: ProjectOwnerPayApplicationReport
  readonly brand: ProjectBrand
  readonly showActions: boolean
}): React.ReactElement {
  const { draft, project } = report
  const g703 = payApplicationReport(draft.lines, draft.ownerDetail)
  const changeOrders = payApplicationChangeOrderSummary(draft.lines)
  const depositCarried = Math.max(0, Math.round((draft.depositAvailable - draft.depositApplied) * 100) / 100)
  const contractNumber = project.projectNumber ?? project.name
  const title = `Pay application ${draft.applicationNumber}`

  return (
    <>
      <style>{`
        @page { size: letter landscape; margin: 0; }
        .pay-app-report {
          --muted-foreground: var(--report-secondary);
          --border: var(--report-rule);
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .pay-app-page {
          width: 11in; min-height: 8.5in; box-sizing: border-box; padding: 0.45in 0.5in;
          margin: 0 auto 18px; font-size: 11.5px; line-height: 1.4;
          border: 1px solid var(--report-rule);
        }
        .pay-app-page table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        .pay-app-page .num { text-align: right; white-space: nowrap; }
        .pay-app-g702 td { padding: 4px 6px; border-bottom: 1px solid var(--report-rule); }
        .pay-app-g702 td:first-child { width: 22px; color: var(--report-secondary); }
        .pay-app-g702 tr.due td { font-weight: 700; border-top: 2px solid currentColor; border-bottom: 2px solid currentColor; }
        .pay-app-g703 th, .pay-app-g703 td { padding: 3px 5px; border: 1px solid var(--report-rule); vertical-align: bottom; }
        .pay-app-g703 th { font-size: 10px; font-weight: 600; text-align: right; }
        .pay-app-g703 th:first-child { text-align: left; }
        .pay-app-g703 th small { display: block; font-weight: 400; color: var(--report-secondary); }
        .pay-app-g703 td { font-size: 10.5px; }
        .pay-app-g703 tr.group td { font-weight: 600; background: var(--report-subtotal); }
        .pay-app-g703 tr.item td:first-child { padding-left: 16px; }
        .pay-app-g703 tfoot td { font-weight: 700; border-top: 2px solid currentColor; background: var(--report-total); }
        .pay-app-cert { border: 1px solid var(--report-rule); padding: 10px 12px; }
        .pay-app-signature {
          display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; margin-top: 34px;
        }
        .pay-app-signature span { border-top: 1px solid currentColor; padding-top: 3px; font-size: 10.5px; }
        @media print {
          body { background: white !important; }
          .document-report-actions { display: none !important; }
          .pay-app-page { margin: 0; border: 0; break-after: page; }
          .pay-app-page:last-child { break-after: auto; }
          .pay-app-g703 thead { display: table-header-group; }
          .pay-app-g703 tr { break-inside: avoid; }
        }
      `}</style>
      {showActions ? (
        <DocumentReportActions
          title={title}
          documentNumber={contractNumber}
          pdfHref={`/api/projects/${projectId}/pay-applications/${draft.id}/pdf`}
        />
      ) : null}
      <main className="pay-app-report overflow-x-auto py-4 text-report-ink print:overflow-visible print:p-0">
        <article className="pay-app-page pay-app-g702-page bg-report-paper" aria-label="G702 application and certificate for payment">
          <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
            <div className="flex items-center gap-4">
              <ProjectBrandLogo brand={brand} size={64} className="size-16 object-contain" />
              <div>
                <p className="text-base font-bold">{brand.companyName}</p>
                <ProjectBrandContactDetails brand={brand} lineClassName="text-xs" />
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-lg font-bold">Application and Certificate for Payment</h1>
              <p className="text-xs">
                Application No. {draft.applicationNumber} · Period to {longDate(draft.periodTo)}
              </p>
              <p className="text-xs">Contract {contractNumber}</p>
            </div>
          </header>

          <section className="mt-4 grid grid-cols-3 gap-6 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wide text-report-secondary">Project</p>
              <p className="mt-1 font-semibold">{project.name}</p>
              {project.address ? <p className="whitespace-pre-line">{project.address}</p> : null}
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-report-secondary">To</p>
              <p className="mt-1 font-semibold">{project.clientName ?? "Project client"}</p>
              {project.clientAddress ? <p className="whitespace-pre-line">{project.clientAddress}</p> : null}
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-report-secondary">From contractor</p>
              <p className="mt-1 font-semibold">{brand.companyName}</p>
              <ProjectBrandContactDetails brand={brand} />
            </div>
          </section>

          <div className="mt-4 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6">
            <div>
              <h2 className="mb-1 text-sm font-semibold">Contractor&apos;s application for payment</h2>
              <table className="pay-app-g702" aria-label="Application summary">
                <tbody>
                  <tr><td>1</td><td>Original contract sum</td><td className="num">{money(draft.originalContractSum)}</td></tr>
                  <tr><td>2</td><td>Net change by change orders</td><td className="num">{money(draft.netChanges)}</td></tr>
                  <tr><td>3</td><td>Contract sum to date (line 1 ± 2)</td><td className="num">{money(draft.contractSumToDate)}</td></tr>
                  <tr><td>4</td><td>Total completed and stored to date (G703)</td><td className="num">{money(draft.totalCompletedStoredToDate)}</td></tr>
                  <tr><td>5</td><td>Retainage</td><td className="num">{money(draft.retainageHeld)}</td></tr>
                  <tr><td>6</td><td>Total earned less retainage (line 4 − 5)</td><td className="num">{money(draft.totalEarnedLessRetainage)}</td></tr>
                  <tr><td>7</td><td>Less previous certificates for payment</td><td className="num">{money(draft.previousCertificates)}</td></tr>
                  <tr>
                    <td>8</td>
                    <td>
                      Less deposit applied
                      {draft.depositApplied > 0 || depositCarried > 0 ? (
                        <span className="text-report-secondary"> ({money(depositCarried)} of the deposit carries forward)</span>
                      ) : null}
                    </td>
                    <td className="num">{money(draft.depositApplied)}</td>
                  </tr>
                  <tr className="due"><td>9</td><td>Current payment due</td><td className="num">{money(draft.currentPaymentDue)}</td></tr>
                  <tr><td>10</td><td>Balance to finish, including retainage (line 3 − 6)</td><td className="num">{money(draft.balanceToFinish)}</td></tr>
                </tbody>
              </table>
              <h2 className="mb-1 mt-4 text-sm font-semibold">Change order summary</h2>
              <table className="pay-app-g702" aria-label="Change order summary">
                <tbody>
                  <tr><td /><td>Approved in previous months</td><td className="num">{money(changeOrders.previous)}</td></tr>
                  {changeOrders.currentItems.map((item) => (
                    <tr key={item.name}><td /><td>Approved this month · {item.name}</td><td className="num">{money(item.amount)}</td></tr>
                  ))}
                  {changeOrders.currentItems.length === 0 ? (
                    <tr><td /><td>Approved this month</td><td className="num">{money(changeOrders.current)}</td></tr>
                  ) : null}
                  <tr className="due"><td /><td>Net change by change orders</td><td className="num">{money(changeOrders.previous + changeOrders.current)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="grid content-start gap-4">
              <section className="pay-app-cert">
                <h2 className="text-sm font-semibold">Contractor certification</h2>
                <p className="mt-1 text-xs">
                  To the best of the contractor&apos;s knowledge, the work covered by this application has been completed in accordance
                  with the contract documents, and the current payment shown is now due.
                </p>
                <SignatureLine left={`Contractor · ${brand.companyName}`} right="Date" />
              </section>
              <section className="pay-app-cert">
                <h2 className="text-sm font-semibold">Reviewed and approved</h2>
                <p className="mt-2 text-xs">
                  Amount certified: <span className="inline-block min-w-[140px] border-b border-current">&nbsp;</span>
                </p>
                <p className="mt-1 text-xs text-report-secondary">
                  If the amount certified differs from the amount applied for, initial each figure changed on this application and
                  the continuation sheet.
                </p>
                <SignatureLine left="Reviewer signature" right="Date" />
                <SignatureLine left="Printed name and title" right="Company" />
              </section>
            </div>
          </div>
          <p className="mt-3 text-right text-xs text-report-secondary">G702 · Application and certificate</p>
        </article>

        <article className="pay-app-page pay-app-g703-page bg-report-paper" aria-label="G703 continuation sheet">
          <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-2">
            <p className="text-sm">
              <span className="font-bold">Continuation sheet</span>
              <span className="text-report-secondary"> · attached to Application No. {draft.applicationNumber}</span>
            </p>
            <div className="text-right text-xs">
              <p>{project.name} · {contractNumber}</p>
              <p>Period to {longDate(draft.periodTo)}</p>
            </div>
          </header>
          <h2 className="mb-2 mt-3 text-sm font-semibold">Progress by {g703.groupLabel.toLowerCase()}</h2>
          <table className="pay-app-g703">
            <thead>
              <tr>
                <th>
                  {g703.groupLabel}
                  <small>A</small>
                </th>
                {G703_COLUMNS.map((column, index) => (
                  <th key={column.key}>
                    {column.label}
                    <small>{COLUMN_LETTERS[index]}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g703.groups.flatMap((group) => [
                <tr key={`group-${group.key}`} className={group.rows.length > 0 ? "group" : undefined}>
                  <td>{group.label}</td>
                  {amountCells(group)}
                </tr>,
                ...group.rows.map((row) => (
                  <tr key={`row-${group.key}-${row.key}`} className="item">
                    <td>{row.label}</td>
                    {amountCells(row)}
                  </tr>
                )),
              ])}
            </tbody>
            <tfoot>
              <tr>
                <td>Totals</td>
                {amountCells(g703.totals)}
              </tr>
            </tfoot>
          </table>
          <p className="mt-3 text-right text-xs text-report-secondary">G703 · Continuation sheet</p>
        </article>
      </main>
    </>
  )
}
