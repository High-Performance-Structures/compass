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

function pct(value: number): string {
  return `${Math.round(value)}%`
}

function barWidth(value: number): string {
  return `${Math.min(100, Math.max(0, value))}%`
}

export function ProjectBudgetPanel({
  projectId,
  summary,
}: {
  readonly projectId: string
  readonly summary: ProjectBudgetSummary | null
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

  const topDivisions = summary.divisions
    .filter((division) => division.adjustedEstimate > 0)
    .slice(0, 6)

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
            {summary.detailMode === "category"
              ? `${summary.divisions.length} owner categories`
              : `${summary.totals.ownerVisibleLineCount} owner-visible lines`}
          </Badge>
          <Link
            href={`/dashboard/projects/${projectId}/budget`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconChartBar className="size-4" />
            Open budget
          </Link>
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
      </div>

      <div className="mt-4 space-y-3">
        {topDivisions.map((division) => (
          <div key={division.csiDivision} className="border-l-2 border-l-teal-500 border-y border-r px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {division.csiDivision} - {division.csiDivisionName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {division.lineCount} line items · {money(division.totalCosts)}
                  {" of "}
                  {money(division.adjustedEstimate)}
                </p>
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

      <div className="mt-4 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
        <IconLock className="mt-0.5 size-4 shrink-0" />
        <p>
          Internal view shows all budget detail. Owner view uses approved
          detail, with H jobs rolled up to category level.
        </p>
      </div>
    </section>
  )
}

export function ProjectBudgetG703Table({
  summary,
}: {
  readonly summary: ProjectBudgetSummary
}): React.ReactElement {
  const showLineDetail = summary.detailMode === "cost_code"

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
            <th className="px-3 py-2 text-left font-medium">Visibility</th>
          </tr>
        </thead>
        <tbody>
          {summary.divisions.map((division) => (
            <Fragment key={division.csiDivision}>
              <tr
                className="border-t bg-muted/25"
              >
                <td className="px-3 py-2 font-semibold" colSpan={2}>
                  {division.csiDivision} - {division.csiDivisionName}
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
                <td className="px-3 py-2 text-right" />
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
                <td className="px-3 py-2" />
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
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
