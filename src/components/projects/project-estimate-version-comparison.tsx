import type {
  ProjectEstimateSummary,
  ProjectEstimateVersionComparison,
} from "@/app/actions/project-estimates"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function signedMoney(cents: number): string {
  if (cents === 0) return money(0)
  return `${cents > 0 ? "+" : "−"}${money(Math.abs(cents))}`
}

function estimateDate(estimate: ProjectEstimateSummary): string {
  const value = estimate.estimateDate ?? estimate.createdAt.slice(0, 10)
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

function changeLabel(change: string): string {
  if (change === "added") return "Added"
  if (change === "removed") return "Removed"
  if (change === "changed") return "Changed"
  return "No change"
}

function VersionHeading({
  label,
  estimate,
}: {
  readonly label: string
  readonly estimate: ProjectEstimateSummary
}): React.ReactElement {
  return (
    <div className="border-l-2 border-l-primary pl-3 print:border-l-black">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-neutral-600">
        {label}
      </p>
      <p className="mt-1 font-semibold">
        {estimate.title} · Version {estimate.versionNumber}
      </p>
      <p className="text-sm text-muted-foreground print:text-neutral-600">
        Estimate date: {estimateDate(estimate)}
      </p>
      <p className="text-xs capitalize text-muted-foreground print:text-neutral-600">
        {estimate.status.replaceAll("_", " ")}
      </p>
    </div>
  )
}

export function ProjectEstimateVersionComparisonDocument({
  data,
}: {
  readonly data: ProjectEstimateVersionComparison
}): React.ReactElement {
  const { baseEstimate, revisedEstimate, comparison } = data
  if (!baseEstimate || !revisedEstimate || !comparison) {
    return (
      <section className="clarity-panel-strong p-6">
        <h2 className="font-semibold">Two estimate versions are required</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Duplicate an estimate to create the next editable version, then return
          here to compare them.
        </p>
      </section>
    )
  }

  return (
    <article className="estimate-comparison-document clarity-panel-strong overflow-hidden bg-background print:border-0 print:bg-white print:text-black print:shadow-none">
      <header className="border-b p-5 print:border-black">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary print:text-black">
          Estimate version comparison
        </p>
        <h1 className="mt-1 text-xl font-semibold">{data.projectName}</h1>
        {data.projectNumber && (
          <p className="text-sm text-muted-foreground print:text-neutral-600">
            Project {data.projectNumber}
          </p>
        )}
        <div className="mt-5 grid gap-5 sm:grid-cols-2 print:grid-cols-2">
          <VersionHeading label="Base estimate" estimate={baseEstimate} />
          <VersionHeading label="Revised estimate" estimate={revisedEstimate} />
        </div>
      </header>

      <section className="grid divide-y border-b sm:grid-cols-3 sm:divide-x sm:divide-y-0 print:grid-cols-3 print:divide-x print:divide-y-0 print:border-black">
        <div className="p-4">
          <p className="text-xs text-muted-foreground print:text-neutral-600">
            Base total
          </p>
          <p className="mt-1 text-lg font-semibold">
            {money(comparison.baseTotalCents)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted-foreground print:text-neutral-600">
            Revised total
          </p>
          <p className="mt-1 text-lg font-semibold">
            {money(comparison.revisedTotalCents)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted-foreground print:text-neutral-600">
            Net change
          </p>
          <p className="mt-1 text-lg font-semibold">
            {signedMoney(comparison.deltaCents)}
          </p>
          <p className="text-xs text-muted-foreground print:text-neutral-600">
            {comparison.changedRowCount} changed cost code
            {comparison.changedRowCount === 1 ? "" : "s"}
          </p>
        </div>
      </section>

      <div className="space-y-6 p-5">
        {comparison.divisions.map((division) => (
          <section key={division.divisionCode} className="break-inside-avoid">
            <div className="grid grid-cols-[minmax(0,1fr)_1.2in_1.2in_1.2in] gap-3 border-b-2 border-foreground pb-2 text-sm font-semibold print:border-black">
              <span>
                {division.divisionCode} · {division.divisionName}
              </span>
              <span className="text-right">
                {money(division.baseTotalCents)}
              </span>
              <span className="text-right">
                {money(division.revisedTotalCents)}
              </span>
              <span className="text-right">
                {signedMoney(division.deltaCents)}
              </span>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[850px] border-collapse text-sm print:min-w-0 print:text-[10px]">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground print:text-[9px] print:text-neutral-600">
                    <th className="w-[1.05in] py-2 pr-3">Cost code</th>
                    <th className="py-2 pr-3">Base scope</th>
                    <th className="w-[1.15in] py-2 pr-3 text-right">Base</th>
                    <th className="py-2 pr-3">Revised scope</th>
                    <th className="w-[1.15in] py-2 pr-3 text-right">Revised</th>
                    <th className="w-[1.1in] py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {division.rows.map((row) => (
                    <tr
                      key={row.key}
                      className="break-inside-avoid border-b align-top"
                    >
                      <td className="py-2 pr-3 font-medium">{row.costCode}</td>
                      <td className="py-2 pr-3 text-muted-foreground print:text-neutral-700">
                        {row.baseDescription ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {row.change === "added" ? "—" : money(row.baseTotalCents)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground print:text-neutral-700">
                        {row.revisedDescription ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {row.change === "removed"
                          ? "—"
                          : money(row.revisedTotalCents)}
                      </td>
                      <td className="py-2 text-right">
                        <span className="font-medium">
                          {signedMoney(row.deltaCents)}
                        </span>
                        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground print:text-neutral-600">
                          {changeLabel(row.change)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <footer className="border-t px-5 py-3 text-xs text-muted-foreground print:border-black print:text-neutral-600">
        Compared {baseEstimate.estimateNumber} version {baseEstimate.versionNumber}
        {` (${estimateDate(baseEstimate)}) with version ${revisedEstimate.versionNumber} (${estimateDate(revisedEstimate)}).`}
      </footer>
    </article>
  )
}
