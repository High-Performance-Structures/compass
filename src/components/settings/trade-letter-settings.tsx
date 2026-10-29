"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { TradeDocType, TradeLetterSettings } from "@/lib/trade-docs/settings"

const NO_AGREEMENT = "__none"

/** Settings → Trade docs: what letters of intent and award letters say. */
export function TradeLetterSettingsFields({
  value,
  onChange,
  docTypes,
  disabled,
}: {
  readonly value: TradeLetterSettings
  readonly onChange: (next: TradeLetterSettings) => void
  readonly docTypes: readonly TradeDocType[]
  readonly disabled: boolean
}): React.ReactElement {
  function set(patch: Partial<TradeLetterSettings>): void {
    onChange({ ...value, ...patch })
  }
  return (
    <fieldset className="grid gap-4 border-t pt-4 sm:max-w-2xl" disabled={disabled}>
      <legend className="sr-only">Letters to trades</legend>
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Letters to trades</h3>
        <p className="text-sm text-muted-foreground">
          From an estimate&apos;s Selected trades, staff send a letter of intent before the owner signs and an award letter
          after. Both are signed through Foxit. Compass adds the scope table, what&apos;s still owed and the signature lines. The
          texts can use {"{company}"}, {"{vendor}"}, {"{project}"}, {"{quote}"}, {"{agreement}"} and {"{owed}"}.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-agreement">Master agreement</Label>
        <Select value={value.agreementDocTypeId ?? NO_AGREEMENT} onValueChange={(next) => set({ agreementDocTypeId: next === NO_AGREEMENT ? null : next })}>
          <SelectTrigger id="trade-letter-agreement" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_AGREEMENT}>None</SelectItem>
            {docTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The document a trade signs once for every job. A trade without one gets its blank form (above) in the same envelope,
          and the signed copy is recorded for them.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-intent">Letter of intent</Label>
        <Textarea id="trade-letter-intent" rows={4} maxLength={3000} value={value.intentText} onChange={(event) => set({ intentText: event.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-award">Award letter</Label>
        <Textarea id="trade-letter-award" rows={4} maxLength={3000} value={value.awardText} onChange={(event) => set({ awardText: event.target.value })} />
        <p className="text-xs text-muted-foreground">{"{agreement}"} reads &quot;signed (date)&quot;, &quot;enclosed with this letter&quot; or &quot;which we will send you to sign&quot;.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-owed">When documents are still owed</Label>
        <Textarea id="trade-letter-owed" rows={3} maxLength={1500} value={value.owedText} onChange={(event) => set({ owedText: event.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-closing">Closing</Label>
        <Textarea id="trade-letter-closing" rows={3} maxLength={3000} value={value.closingText} onChange={(event) => set({ closingText: event.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trade-letter-title">Signer&apos;s title</Label>
        <Input id="trade-letter-title" className="w-72" maxLength={80} value={value.companySignerTitle} placeholder="e.g. President" onChange={(event) => set({ companySignerTitle: event.target.value })} />
        <p className="text-xs text-muted-foreground">Printed under the name of whoever sends the letter. They can change it on each letter.</p>
      </div>
    </fieldset>
  )
}
