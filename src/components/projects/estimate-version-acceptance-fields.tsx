"use client"

import * as React from "react"

import {
  getContractVersionAcceptancePreview,
  type ContractVersionAcceptancePreview,
} from "@/app/actions/project-estimates"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { VersionDifferenceKind } from "@/lib/change-orders/version-difference"

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function signedMoney(cents: number): string {
  return cents > 0 ? `+${money(cents)}` : money(cents)
}

const KIND_LABEL: Readonly<Record<VersionDifferenceKind, string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
}

/**
 * Shown in "Record acceptance" when this version would change an accepted
 * contract: the line-by-line differences, and the choice between replacing
 * the contract and adding a change order. Both create a change order.
 */
export function EstimateVersionAcceptanceFields({
  projectId,
  estimateId,
  onReplacesContractChange,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly onReplacesContractChange: (replacesContract: boolean) => void
}): React.ReactElement | null {
  const [preview, setPreview] = React.useState<ContractVersionAcceptancePreview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [treatment, setTreatment] = React.useState<string>("")

  React.useEffect(() => {
    let cancelled = false
    void getContractVersionAcceptancePreview(projectId, estimateId).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setError(result.error)
        return
      }
      setPreview(result.preview)
      onReplacesContractChange(result.preview.replacesContract)
      if (result.preview.replacesContract && result.preview.replaceBlockers.length > 0) {
        setTreatment("difference_change_order")
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId, estimateId, onReplacesContractChange])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!preview?.replacesContract) return null

  const { baseline } = preview
  const blocked = preview.replaceBlockers.length > 0
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">
          This version changes the accepted contract (v{baseline.versionNumber})
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {money(baseline.totalCents)} → {money(preview.newTotalCents)} ({signedMoney(preview.netChangeCents)}).
          Compass records a change order either way.
        </p>
      </div>

      <input type="hidden" name="versionTreatment" value={treatment} />
      <RadioGroup value={treatment} onValueChange={setTreatment} className="gap-3">
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="replace_contract" disabled={blocked} className="mt-0.5" />
          <span>
            <span className="font-medium">Replace the contract estimate</span>
            <span className="block text-xs text-muted-foreground">
              v{baseline.versionNumber} is superseded and the budget is rebuilt from this version, so the
              contract shows one number (for example, for a lender). The change order lists the differences
              for the record only.
            </span>
            {blocked && (
              <span className="mt-1 block text-xs text-destructive">
                Not available: {preview.replaceBlockers.join(" ")}
              </span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="difference_change_order" className="mt-0.5" />
          <span>
            <span className="font-medium">Keep the contract and add a change order</span>
            <span className="block text-xs text-muted-foreground">
              The original contract sum stays v{baseline.versionNumber}; an executed change order carries
              the line-by-line differences into the budget.
            </span>
          </span>
        </label>
      </RadioGroup>

      <div className="space-y-1.5">
        <Label htmlFor="versionSummary">What changed</Label>
        <Textarea
          id="versionSummary"
          name="versionSummary"
          required
          maxLength={10_000}
          placeholder="Describe the plan change and any edits to the contract packet. This becomes the change order's scope."
        />
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">
          {preview.lines.length === 0
            ? "No priced lines changed."
            : `${preview.lines.length} changed ${preview.lines.length === 1 ? "line" : "lines"}`}
        </p>
        {preview.lines.length > 0 && (
          <div className="mt-2 max-h-72 overflow-auto border-y">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Cost code</th>
                  <th className="py-1.5 pr-2 font-medium">Line</th>
                  <th className="py-1.5 pr-2 font-medium"></th>
                  <th className="py-1.5 pr-2 text-right font-medium">v{baseline.versionNumber}</th>
                  <th className="py-1.5 pr-2 text-right font-medium">This version</th>
                  <th className="py-1.5 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.lineNumber} className="border-t">
                    <td className="py-1.5 pr-2 tabular-nums">{line.costCode}</td>
                    <td className="py-1.5 pr-2">{line.description}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{KIND_LABEL[line.kind]}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(line.previousAmountCents)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(line.newAmountCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{signedMoney(line.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
