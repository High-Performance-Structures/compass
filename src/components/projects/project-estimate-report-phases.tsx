import { Fragment } from "react"

import { clientEstimateTaxSummary, type ClientEstimateLine, type ClientEstimateLineCostItem, type ClientEstimatePhase, type EstimateClientReportMode } from "@/lib/estimates/client-report"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value)
}

function TaxNote({ line }: { readonly line: ClientEstimateLine }): React.ReactElement | null {
  if (line.taxCents <= 0) return null
  const summary = clientEstimateTaxSummary([line])
  const group = summary.groups.length === 1 ? summary.groups[0] : null
  const context = group ? [group.label, `${group.rateBasisPoints / 100}%`].filter(Boolean).join(" ") : ""
  return <p className="mt-1 text-xs font-normal italic text-muted-foreground">Includes {money(line.taxCents)} sales tax{context ? ` · ${context}` : ""}</p>
}

function CostRow({ item }: { readonly item: ClientEstimateLine | ClientEstimateLineCostItem }): React.ReactElement {
  return (
    <tr className="break-inside-avoid border-b">
      <td className="py-2 pr-2 align-top font-medium">
        <p>{item.costCode} · {item.costCodeName}</p>
        {item.description.trim() !== item.costCodeName.trim() && <p className="mt-1 font-normal text-muted-foreground">{item.description}</p>}
        {"ownerVisible" in item ? <>
          <TaxNote line={item} />
          {!item.includeInBuilderFee && <p className="mt-1 text-xs font-normal italic text-muted-foreground">Included in project cost; excluded from builder-fee calculation.</p>}
        </> : item.taxCents > 0 && <p className="mt-1 text-xs font-normal italic text-muted-foreground">Includes {money(item.taxCents)} sales tax</p>}
      </td>
      <td className="py-2 pr-2 text-right align-top">{quantity(item.quantity)}</td>
      <td className="py-2 pr-2 align-top">{item.unit}</td>
      <td className="py-2 pr-2 text-right align-top">{money(item.unitCostCents)}</td>
      <td className="py-2 text-right align-top">{money(item.lineTotalCents)}</td>
    </tr>
  )
}

function DefaultCsiReport({ phases, reportMode }: {
  readonly phases: readonly ClientEstimatePhase[]
  readonly reportMode: EstimateClientReportMode
}): React.ReactElement {
  if (reportMode !== "line_items") {
    return <section className="mt-6">
      <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
        <span>{reportMode === "phase_summary" ? "Phase description" : "Division"}</span>
        <span className="text-right">Subtotal</span>
      </div>
      {phases.map((phase) => <div key={phase.id} className="grid break-inside-avoid grid-cols-[1fr_1.2in] gap-3 border-b py-3 text-sm">
        <div>
          <p className="font-semibold">{reportMode === "phase_summary" ? phase.description : phase.divisionName}</p>
          <p className="text-xs text-muted-foreground">{reportMode === "phase_summary" ? "Phase" : "Division"} {phase.divisionCode}</p>
          {phase.taxCents > 0 && <p className="mt-1 text-xs italic text-muted-foreground">Includes {money(phase.taxCents)} sales tax</p>}
        </div>
        <span className="text-right font-semibold">{money(phase.subtotalCents)}</span>
      </div>)}
    </section>
  }
  return <section className="mt-6">
    <table className="w-full border-collapse text-sm">
      <thead><tr className="border-b border-black text-left text-xs font-semibold uppercase tracking-wide">
        <th className="pb-1 pr-2">Cost code item</th>
        <th className="pb-1 pr-2 text-right">Quantity</th>
        <th className="pb-1 pr-2">Unit</th>
        <th className="pb-1 pr-2 text-right">Unit cost</th>
        <th className="pb-1 text-right">Total cost</th>
      </tr></thead>
      <tbody>{phases.map((phase) => <Fragment key={phase.id}>
        <tr className="break-inside-avoid border-b bg-muted font-semibold"><td className="py-2 pr-2" colSpan={5}>{phase.divisionCode} · {phase.description}</td></tr>
        {phase.lines.map((line) => <CostRow key={line.id} item={line} />)}
        <tr className="break-inside-avoid border-b-2 border-black font-semibold">
          <td className="py-2" colSpan={4}>Total: {phase.divisionCode} · {phase.description}</td>
          <td className="py-2 text-right">{money(phase.subtotalCents)}</td>
        </tr>
      </Fragment>)}</tbody>
    </table>
  </section>
}

export function ProjectEstimateReportPhases({ phases, reportMode }: {
  readonly phases: readonly ClientEstimatePhase[]
  readonly reportMode: EstimateClientReportMode
}): React.ReactElement {
  // Preserve the existing compact report when no custom phase is in use.
  if (phases.every((phase) => !phase.custom)) return <DefaultCsiReport phases={phases} reportMode={reportMode} />
  return (
    <section className="mt-6" aria-label="Project work by phase">
      {phases.map((phase) => {
        const title = phase.custom ? phase.name : reportMode === "division_summary" ? phase.divisionName : phase.description
        return (
          <div key={phase.id} className="mb-5">
            <div className="grid break-inside-avoid grid-cols-[1fr_1.2in] gap-3 border-b py-3 text-sm">
              <div>
                <p className="font-semibold">{title}</p>
                {phase.custom && phase.description && <p className="mt-1 whitespace-pre-wrap font-normal leading-5">{phase.description}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{phase.custom ? "Source CSI division" : reportMode === "phase_summary" ? "Phase" : "Division"} {phase.divisionCode}{phase.custom ? ` · ${phase.itemize ? "Itemized" : "Lump sum"}` : ""}</p>
                {!phase.itemize && phase.taxCents > 0 && <p className="mt-1 text-xs italic text-muted-foreground">Includes {money(phase.taxCents)} sales tax</p>}
              </div>
              {!phase.itemize && <span className="text-right font-semibold">{money(phase.subtotalCents)}</span>}
            </div>
            {phase.itemize && <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b text-left text-xs font-semibold uppercase tracking-wide">
                <th className="py-2 pr-2">Cost code item</th>
                <th className="py-2 pr-2 text-right">Quantity</th>
                <th className="py-2 pr-2">Unit</th>
                <th className="py-2 pr-2 text-right">Unit cost</th>
                <th className="py-2 text-right">Total cost</th>
              </tr></thead>
              <tbody>
                {phase.lines.map((line) => phase.custom && line.costItems.length > 0 ? (
                  <Fragment key={line.id}>
                    <tr className="break-inside-avoid border-b"><td colSpan={5} className="py-2 font-medium">{line.costCode} · {line.description}</td></tr>
                    {line.costItems.map((item) => <CostRow key={item.id} item={item} />)}
                    <tr className="break-inside-avoid border-b"><td colSpan={4} className="py-2">
                      Assembly subtotal: {line.description}
                      <TaxNote line={line} />
                      {!line.includeInBuilderFee && <p className="mt-1 text-xs italic text-muted-foreground">Included in project cost; excluded from builder-fee calculation.</p>}
                    </td><td className="py-2 text-right">{money(line.lineTotalCents)}</td></tr>
                  </Fragment>
                ) : <CostRow key={line.id} item={line} />)}
                <tr className="break-inside-avoid border-b-2 font-semibold">
                  <td className="py-2" colSpan={4}>Total: {title}</td>
                  <td className="py-2 text-right">{money(phase.subtotalCents)}</td>
                </tr>
              </tbody>
            </table>}
          </div>
        )
      })}
    </section>
  )
}
