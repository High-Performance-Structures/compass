"use client"

/*
 * "Selections installed" on a daily log: the job's approved or ordered
 * finish selections. Ticking one moves it to Installed when the log is
 * saved (never backward), and the Activity entry names the log.
 */
import * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"
import type { DailyLogFollowUpDraft, DailyLogInstallableSelection } from "@/lib/daily-logs/log-followups"

export function DailyLogSelectionsInstalled({
  idPrefix,
  selections,
  draft,
  onChange,
}: {
  readonly idPrefix: string
  readonly selections: readonly DailyLogInstallableSelection[]
  readonly draft: DailyLogFollowUpDraft
  readonly onChange: (draft: DailyLogFollowUpDraft) => void
}): React.ReactElement | null {
  if (selections.length === 0) return null
  const installed = new Set(draft.installed ?? [])
  function toggle(id: string, on: boolean): void {
    const next = new Set(installed)
    if (on) next.add(id)
    else next.delete(id)
    onChange({ ...draft, installed: [...next] })
  }
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-sm font-medium">Selections installed</legend>
      <p className="text-xs text-muted-foreground">Tick the finish selections installed today. They move to Installed when the log is saved.</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {selections.map((selection) => (
          <label key={selection.id} htmlFor={`${idPrefix}-installed-${selection.id}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${idPrefix}-installed-${selection.id}`}
              checked={installed.has(selection.id)}
              onCheckedChange={(value) => toggle(selection.id, value === true)}
            />
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{selection.roomName} · </span>
              {selection.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
