import {
  IconChartBar,
  IconFileDollar,
  IconLock,
  IconReceipt2,
} from "@tabler/icons-react"
import Link from "next/link"
import { Fragment } from "react"

import type { ProjectBudgetSummary } from "@/app/actions/project-budget"
import { Badge } from "@/components/ui/badge"

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "Not dated"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function isAssemblyMode(summary: ProjectBudgetSummary): boolean {
  return (
    summary.detailMode === "assembly" ||
    summary.detailMode === "assembly_percent"
  )
}

/** Assemblies show by name; divisions by code and name. */
function groupLabel(
  summary: ProjectBudgetSummary,
  division: { readonly csiDivision: string; readonly csiDivisionName: string }
): string {
  return isAssemblyMode(summary)
    ? division.csiDivisionName
    : `${division.csiDivision} - ${division.csiDivisionName}`
}

function pct(value: number): string {
  return `${Math.round(value)}%`
}

function barWidth(value: number): string {
  return `${Math.min(100, Math.max(0, value))}%`
}

export function ProjectBudgetPanel({
  projectId,
  summary,
  detailHref,
  divisionLimit = 6,
}: {
  readonly projectId: string
  readonly summary: ProjectBudgetSummary | null
  readonly detailHref?: string | null
  readonly divisionLimit?: number | null
}): React.ReactElement {
  if (!summary || summary.allLines.length === 0) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconFileDollar className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Project Budget</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No budget snapshot mapped yet.
        </p>
      </section>
    )
  }

  const percentOnly =
    summary.detailMode === "category_percent" ||
    summary.detailMode === "assembly_percent"
  const visibleDivisions = summary.divisions.filter((division) =>
    percentOnly ? division.lineCount > 0 : division.adjustedEstimate > 0
  )
  const displayedDivisions =
    divisionLimit === null
      ? visibleDivisions
      : visibleDivisions.slice(0, divisionLimit)
  const resolvedDetailHref =
    detailHref === undefined
      ? `/dashboard/projects/${projectId}/budget`
      : detailHref

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconFileDollar className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Project Budget</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule of Values and G703 progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {summary.currentApplication
              ? `Pay app ${summary.currentApplication.applicationNumber}`
              : "Budget snapshot"}
          </Badge>
          <Badge variant="secondary">
            {summary.detailMode !== "cost_code"
              ? `${summary.divisions.length} owner categories`
              : `${summary.totals.ownerVisibleLineCount} owner-visible lines`}
          </Badge>
          {resolvedDetailHref && (
            <Link
              href={resolvedDetailHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconChartBar className="size-4" />
              Open budget
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3 lg:grid-cols-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Contract to date</p>
          <p className="mt-1 truncate text-xl font-semibold leading-none">
            {money(
              summary.currentApplication?.contractSumToDate ??
                summary.totals.adjustedEstimate
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(summary.currentApplication?.periodTo ?? null)}
          </p>
        </div>
        {percentOnly ? (
          <>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Complete</p>
              <p className="mt-1 truncate text-xl font-semibold leading-none">
                {pct(summary.totals.percentComplete)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Work completed to date</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Payment due</p>
              <p className="mt-1 truncate text-xl font-semibold leading-none">
                {money(summary.currentApplication?.currentPaymentDue ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">This pay request</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="mt-1 truncate text-xl font-semibold leading-none">
                {pct(Math.max(0, 100 - summary.totals.percentComplete))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Work left to complete</p>
            </div>
          </>
        ) : (
          <>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Complete + stored</p>
          <p className="mt-1 truncate text-xl font-semibold leading-none">
            {money(summary.totals.totalCosts)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pct(summary.totals.percentComplete)} of visible budget
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Current period</p>
          <p className="mt-1 truncate text-xl font-semibold leading-none">
            {money(summary.totals.currentCosts)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This draw / current costs
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Balance to finish</p>
          <p className="mt-1 truncate text-xl font-semibold leading-none">
            {money(summary.totals.balanceToFinish)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.totals.overBudgetAmount > 0
              ? `${money(summary.totals.overBudgetAmount)} over`
              : "Tracking within the current budget"}
          </p>
        </div>
          </>
        )}
      </div>

      <div className="mt-4 space-y-3 print:hidden">
        {displayedDivisions.map((division) => (
          <div key={division.csiDivision} className="border-l-2 border-l-teal-500 border-y border-r px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {groupLabel(summary, division)}
                </p>
                {!percentOnly && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {division.lineCount} line items · {money(division.totalCosts)}
                    {" of "}
                    {money(division.adjustedEstimate)}
                  </p>
                )}
              </div>
              <Badge variant="outline">{pct(division.percentComplete)}</Badge>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: barWidth(division.percentComplete) }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground print:hidden">
        <IconLock className="mt-0.5 size-4 shrink-0" />
        <p>
          Internal view shows all budget detail. Owner view uses the detail
          chosen on the pay application, or the company default in Settings.
        </p>
      </div>
    </section>
  )
}

export function ProjectBudgetG703Table({
  summary,
  showVisibility = true,
}: {
  readonly summary: ProjectBudgetSummary
  readonly showVisibility?: boolean
}): React.ReactElement {
  const showLineDetail = summary.detailMode === "cost_code"
  if (
    summary.detailMode === "category_percent" ||
    summary.detailMode === "assembly_percent"
  ) {
    return <ProjectBudgetPercentTable summary={summary} />
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[980px] w-full border-collapse text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Cost code</th>
            <th className="px-3 py-2 text-left font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Original</th>
            <th className="px-3 py-2 text-right font-medium">Changes</th>
            <th className="px-3 py-2 text-right font-medium">Adjusted</th>
            <th className="px-3 py-2 text-right font-medium">Prior</th>
            <th className="px-3 py-2 text-right font-medium">Current</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">%</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
            {showVisibility && (
              <th className="px-3 py-2 text-left font-medium">Visibility</th>
            )}
          </tr>
        </thead>
        <tbody>
          {summary.divisions.map((division) => (
            <Fragment key={division.csiDivision}>
              <tr
                className="border-t bg-muted/25"
              >
                <td className="px-3 py-2 font-semibold" colSpan={2}>
                  {groupLabel(summary, division)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.originalEstimate)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.totalChanges)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.adjustedEstimate)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.priorCosts)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.currentCosts)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.totalCosts)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {pct(division.percentComplete)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {money(division.balanceToFinish)}
                </td>
                {showVisibility && <td className="px-3 py-2" />}
              </tr>
              {showLineDetail &&
                division.lines.map((line) => (
                  <tr key={line.id} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">
                      {line.costCode}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[300px]">
                        <p className="font-medium">
                          {line.ownerLabel ?? line.description}
                        </p>
                        {line.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {line.notes}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.originalEstimate)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.totalChanges)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.adjustedEstimate)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.priorCosts)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.currentCosts)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.totalCosts)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {pct(line.percentComplete)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(line.balanceToFinish)}
                    </td>
                    {showVisibility && (
                      <td className="px-3 py-2">
                        {line.ownerVisible ? (
                          <Badge variant="secondary">Owner</Badge>
                        ) : (
                          <Badge variant="outline">
                            <IconReceipt2 className="mr-1 size-3" />
                            Internal
                          </Badge>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-muted/50">
          <tr>
            <td className="px-3 py-3 text-left font-semibold" colSpan={2}>
              G703 project totals
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.originalEstimate)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.totalChanges)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.adjustedEstimate)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.priorCosts)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.currentCosts)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.totalCosts)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {pct(summary.totals.percentComplete)}
            </td>
            <td className="px-3 py-3 text-right font-semibold">
              {money(summary.totals.balanceToFinish)}
            </td>
            {showVisibility && <td className="px-3 py-3" />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Client view of a pay request by division, percent complete only. */
function ProjectBudgetPercentTable({
  summary,
}: {
  readonly summary: ProjectBudgetSummary
}): React.ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">
              {isAssemblyMode(summary) ? "Assembly" : "Division"}
            </th>
            <th className="px-3 py-2 text-right font-medium">% complete</th>
          </tr>
        </thead>
        <tbody>
          {summary.divisions.map((division) => (
            <tr key={division.csiDivision} className="border-t">
              <td className="px-3 py-2 font-medium">
                {groupLabel(summary, division)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {pct(division.percentComplete)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-muted/50">
          <tr>
            <td className="px-3 py-3 font-semibold">Project</td>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">
              {pct(summary.totals.percentComplete)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
