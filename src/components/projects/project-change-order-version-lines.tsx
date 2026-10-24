import type * as React from "react"

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
}

type VersionLine = {
  readonly id: string
  readonly costCode: string | null
  readonly description: string
  readonly amountCents: number | null
  readonly changeKind: string | null
  readonly previousAmountCents: number | null
  readonly newAmountCents: number | null
}

/**
 * Line-by-line differences recorded when a newer contract-estimate version
 * was accepted. On a replacement they are a record only; on a difference
 * change order they are what the budget adds.
 */
export function ProjectChangeOrderVersionLines({
  lines,
  affectsBudget,
}: {
  readonly lines: readonly VersionLine[]
  readonly affectsBudget: boolean
}): React.ReactElement | null {
  const compared = lines.filter((line) => line.changeKind !== null)
  if (compared.length === 0) return <ProjectChangeOrderCostLines lines={lines} />
  const net = compared.reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
  return (
    <section className="border-y py-4">
      <h2 className="text-sm font-semibold">Changes from the previous version</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {affectsBudget
          ? "These differences are added to the contract budget."
          : "For the record: the budget was rebuilt from the new version, so these lines don't add to it."}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Cost code</th>
              <th className="py-1.5 pr-3 font-medium">Line</th>
              <th className="py-1.5 pr-3 font-medium"></th>
              <th className="py-1.5 pr-3 text-right font-medium">Was</th>
              <th className="py-1.5 pr-3 text-right font-medium">Now</th>
              <th className="py-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {compared.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="py-1.5 pr-3 tabular-nums">{line.costCode}</td>
                <td className="py-1.5 pr-3">{line.description}</td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">{KIND_LABEL[line.changeKind ?? ""] ?? ""}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(line.previousAmountCents ?? 0)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(line.newAmountCents ?? 0)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(line.amountCents ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t font-medium">
              <td className="py-1.5 pr-3" colSpan={5}>Net change</td>
              <td className="py-1.5 text-right tabular-nums">{money(net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * A change order's cost lines, read-only. They come from its accepted
 * estimate, or were recorded before change orders were built from estimates.
 */
function ProjectChangeOrderCostLines({ lines }: { readonly lines: readonly VersionLine[] }): React.ReactElement | null {
  if (lines.length === 0) return null
  const total = lines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
  return (
    <section className="border-y py-4">
      <h2 className="text-sm font-semibold">Cost lines</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Cost code</th>
              <th className="py-1.5 pr-3 font-medium">Line</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="py-1.5 pr-3 tabular-nums">{line.costCode ?? "Not coded"}</td>
                <td className="py-1.5 pr-3">{line.description}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {line.amountCents === null ? "Not priced" : money(line.amountCents)}
                </td>
              </tr>
            ))}
            <tr className="border-t font-medium">
              <td className="py-1.5 pr-3" colSpan={2}>Total</td>
              <td className="py-1.5 text-right tabular-nums">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
