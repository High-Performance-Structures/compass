import { Fragment } from "react"

import { cn } from "@/lib/utils"
import {
  clientEstimateTaxSummary,
  type ClientEstimateLine,
  type ClientEstimateLineCostItem,
  type ClientEstimatePhase,
  type EstimateClientReportMode,
} from "@/lib/estimates/client-report"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(
    value
  )
}

function TaxNote({
  line,
}: {
  readonly line: ClientEstimateLine
}): React.ReactElement | null {
  if (line.taxCents <= 0) return null
  const summary = clientEstimateTaxSummary([line])
  const group = summary.groups.length === 1 ? summary.groups[0] : null
  const context = group
    ? [group.label, `${group.rateBasisPoints / 100}%`].filter(Boolean).join(" ")
    : ""
  return (
    <p className="mt-1 text-xs font-normal italic text-muted-foreground">
      Includes {money(line.taxCents)} sales tax{context ? ` · ${context}` : ""}
    </p>
  )
}

function CostRow({
  item,
  sourceDivision,
  breakdown = false,
}: {
  readonly item: ClientEstimateLine | ClientEstimateLineCostItem
  readonly sourceDivision?: string
  readonly breakdown?: boolean
}): React.ReactElement {
  return (
    <tr
      className={cn(
        "break-inside-avoid border-b",
        breakdown && "bg-report-subtotal text-xs"
      )}
    >
      <td
        className={cn(
          "py-2 pr-3 align-top",
          breakdown ? "pl-10" : "pl-6 font-medium"
        )}
      >
        <p className="break-words">
          {item.costCode} · {item.costCodeName}
        </p>
        {sourceDivision && (
          <p className="mt-1 text-xs font-normal text-muted-foreground">
            {sourceDivision}
          </p>
        )}
        {item.description.trim() !== item.costCodeName.trim() && (
          <p className="mt-1 whitespace-pre-wrap break-words font-normal text-muted-foreground">
            {item.description}
          </p>
        )}
        {"ownerVisible" in item ? (
          <>
            <TaxNote line={item} />
            {!item.includeInBuilderFee && (
              <p className="mt-1 text-xs font-normal italic text-muted-foreground">
                Included in project cost; excluded from builder-fee calculation.
              </p>
            )}
          </>
        ) : (
          item.taxCents > 0 && (
            <p className="mt-1 text-xs font-normal italic text-muted-foreground">
              Includes {money(item.taxCents)} sales tax
            </p>
          )
        )}
      </td>
      <td className="py-2 pr-3 text-right align-top tabular-nums">
        {quantity(item.quantity)}
      </td>
      <td className="py-2 pr-3 align-top">{item.unit}</td>
      <td className="whitespace-nowrap py-2 pr-3 text-right align-top tabular-nums">
        {money(item.unitCostCents)}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-right align-top tabular-nums">
        {money(item.lineTotalCents)}
      </td>
    </tr>
  )
}

function CostRows({
  line,
  assemblyReport,
  showCostBreakdowns,
}: {
  readonly line: ClientEstimateLine
  readonly assemblyReport: boolean
  readonly showCostBreakdowns: boolean
}): React.ReactElement {
  return (
    <>
      <CostRow
        item={line}
        sourceDivision={
          assemblyReport
            ? `${line.divisionCode} · ${line.divisionName}`
            : undefined
        }
      />
      {showCostBreakdowns && line.costItems.length > 0 && (
        <>
          <tr className="break-inside-avoid bg-report-subtotal">
            <td
              colSpan={5}
              className="py-1 pl-10 pr-3 text-xs text-muted-foreground"
            >
              Cost breakdown · included in the cost code amount above
            </td>
          </tr>
          {line.costItems.map((item) => (
            <CostRow key={item.id} item={item} breakdown />
          ))}
        </>
      )}
    </>
  )
}

function scopeDescription(phase: ClientEstimatePhase): string {
  const description = phase.description.trim()
  if (
    description &&
    (phase.custom || description !== phase.divisionName.trim())
  )
    return description
  // Itemized groups already show their scopes beneath each cost code.
  if (phase.itemize) return ""
  // Summarize only customer-visible parent scopes when no group description was saved.
  return [
    ...new Set(
      phase.lines
        .map((line) => line.description.trim() || line.costCodeName.trim())
        .filter(Boolean)
    ),
  ].join("; ")
}

function TotalRow({
  label,
  cents,
  final = false,
  children,
}: {
  readonly label: string
  readonly cents: number
  readonly final?: boolean
  readonly children?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      className={cn(
        "grid break-inside-avoid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-3 py-2 text-sm",
        final ? "bg-report-total font-semibold" : "bg-report-subtotal"
      )}
    >
      <div className="min-w-0 break-words">
        <p>{label}</p>
        {children}
      </div>
      <span className="whitespace-nowrap text-right tabular-nums">
        {money(cents)}
      </span>
    </div>
  )
}

export function ProjectEstimateReportPhases({
  phases,
  reportMode,
  assemblyBuilderFees,
  showCostBreakdowns = false,
}: {
  readonly phases: readonly ClientEstimatePhase[]
  readonly reportMode: EstimateClientReportMode
  readonly assemblyBuilderFees?: ReadonlyMap<string, number>
  readonly showCostBreakdowns?: boolean
}): React.ReactElement {
  const assemblyReport =
    reportMode === "assembly_summary" || reportMode === "assembly_items"
  return (
    <section
      className="mt-6"
      aria-label={
        assemblyReport
          ? "Project work by assembly"
          : "Project work by division or phase"
      }
    >
      {phases.map((phase) => {
        const builderFeeCents = assemblyReport
          ? assemblyBuilderFees?.get(phase.id)
          : undefined
        const title = phase.custom
          ? phase.name
          : `${phase.divisionCode} · ${reportMode === "division_summary" ? phase.divisionName : phase.description}`
        const description = scopeDescription(phase)
        return (
          <Fragment key={phase.id}>
            <div className="mb-5">
              <div className="break-inside-avoid border-b bg-report-heading px-3 py-3 text-sm font-semibold">
                {title}
              </div>
              {description && (phase.custom || !phase.itemize) && (
                <p className="break-inside-avoid whitespace-pre-wrap break-words px-3 py-3 text-sm leading-5">
                  {description}
                </p>
              )}
              {!assemblyReport && phase.custom && (
                <p className="px-3 pb-2 text-xs text-muted-foreground">
                  Source CSI division {phase.divisionCode} ·{" "}
                  {phase.itemize ? "Itemized" : "Lump sum"}
                </p>
              )}
              {phase.itemize && (
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full min-w-[32rem] border-collapse text-sm print:min-w-0">
                    <thead>
                      <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide">
                        <th className="py-2 pl-6 pr-3">Cost code item</th>
                        <th className="py-2 pr-3 text-right">Quantity</th>
                        <th className="py-2 pr-3">Unit</th>
                        <th className="py-2 pr-3 text-right">Unit cost</th>
                        <th className="py-2 pr-3 text-right">Total cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phase.lines.map((line) => (
                        <CostRows
                          key={line.id}
                          line={line}
                          assemblyReport={assemblyReport}
                          showCostBreakdowns={showCostBreakdowns}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!phase.itemize && phase.taxCents > 0 && (
                <p className="px-3 pb-2 text-xs italic text-muted-foreground">
                  Includes {money(phase.taxCents)} sales tax
                </p>
              )}
              <div className="break-inside-avoid">
                <TotalRow
                  label={
                    builderFeeCents !== undefined
                      ? "Work subtotal"
                      : phase.itemize
                        ? `Total: ${title}`
                        : assemblyReport
                          ? "Assembly subtotal"
                          : "Subtotal"
                  }
                  cents={phase.subtotalCents}
                  final={builderFeeCents === undefined}
                />
                {builderFeeCents !== undefined && (
                  <>
                    <TotalRow
                      label="Builder-fee subtotal"
                      cents={builderFeeCents}
                    >
                      <p className="text-xs font-normal text-muted-foreground">
                        Overhead, margin, and contingency
                      </p>
                    </TotalRow>
                    <TotalRow
                      label="Assembly total including builder fee"
                      cents={phase.subtotalCents + builderFeeCents}
                      final
                    />
                  </>
                )}
              </div>
            </div>
          </Fragment>
        )
      })}
    </section>
  )
}
