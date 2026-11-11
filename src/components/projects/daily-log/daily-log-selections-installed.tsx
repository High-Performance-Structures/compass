"use client"

/*
 * "Selections installed" on a daily log: the job's finish selections not
 * installed yet (Deferred and Unavailable left out). Ordered and approved
 * ones show first; the rest fold under "Other selections". Ticking one moves
 * it to Installed when the log is saved (never backward), and the Activity
 * entry names the log.
 */
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { DailyLogFollowUpDraft, DailyLogInstallableSelection } from "@/lib/daily-logs/log-followups"
import { PROJECT_SELECTION_STATUS_LABELS, PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"

function statusLabel(status: string): string {
  const known = PROJECT_SELECTION_STATUSES.find((value) => value === status)
  return known ? PROJECT_SELECTION_STATUS_LABELS[known] : status
}

/** Ordered and approved selections are the likeliest to be going in. */
function readyToInstall(selection: DailyLogInstallableSelection): boolean {
  return selection.status === "ordered" || selection.status === "approved"
}

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
  const [showOthers, setShowOthers] = React.useState(false)
  if (selections.length === 0) return null
  const installed = new Set(draft.installed ?? [])
  function toggle(id: string, on: boolean): void {
    const next = new Set(installed)
    if (on) next.add(id)
    else next.delete(id)
    onChange({ ...draft, installed: [...next] })
  }
  const ready = selections.filter(readyToInstall)
  const others = selections.filter((selection) => !readyToInstall(selection))
  // With nothing ordered or approved, the rest show without the extra click.
  const othersShown = showOthers || ready.length === 0 || others.some((selection) => installed.has(selection.id))
  const row = (selection: DailyLogInstallableSelection): React.ReactElement => (
    <label key={selection.id} htmlFor={`${idPrefix}-installed-${selection.id}`} className="flex items-center gap-2 text-sm">
      <Checkbox
        id={`${idPrefix}-installed-${selection.id}`}
        checked={installed.has(selection.id)}
        onCheckedChange={(value) => toggle(selection.id, value === true)}
      />
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground">{selection.roomName} · </span>
        {selection.name}
        <span className="text-muted-foreground">
          {" "}· {statusLabel(selection.status)}{installed.has(selection.id) ? " → Installed" : ""}
        </span>
      </span>
    </label>
  )
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-sm font-medium">Selections installed</legend>
      <p className="text-xs text-muted-foreground">Tick the finish selections installed today. They move to Installed when the log is saved.</p>
      {ready.length > 0 && <div className="grid gap-1 sm:grid-cols-2">{ready.map(row)}</div>}
      {others.length > 0 && ready.length > 0 && !othersShown && (
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowOthers(true)}>
          Other selections ({others.length})
        </Button>
      )}
      {others.length > 0 && othersShown && <div className="grid gap-1 sm:grid-cols-2">{others.map(row)}</div>}
    </fieldset>
  )
}
