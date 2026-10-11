"use client"

import * as React from "react"
import Link from "next/link"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import { cn } from "@/lib/utils"

const STATUS_LABEL: ReadonlyMap<string, string> = new Map(
  PROJECT_JOB_STATUS_DEFINITIONS.map((status) => [status.id, status.label]),
)

export function jobStatusLabel(statusId: string): string {
  return STATUS_LABEL.get(statusId) ?? statusId
}

export type StatusMoveGroup = {
  readonly id: string
  readonly label: string
  /** CSS color for the group's swatch. */
  readonly color: string
  readonly statuses: readonly string[]
}

/**
 * One-click status moves from the map panel, grouped by phase or sales stage.
 * Shared by the project and sales panels so both work the same way.
 */
export function StatusMovePicker({
  groups,
  currentStatusId,
  disabled,
  error,
  onMove,
}: {
  readonly groups: readonly StatusMoveGroup[]
  readonly currentStatusId: string | null
  readonly disabled: boolean
  readonly error: string | null
  readonly onMove: (statusId: string) => void
}): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">MOVE TO</legend>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2" style={{ background: group.color }} aria-hidden="true" />
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1 pl-4">
            {group.statuses.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={currentStatusId === status}
                onClick={() => onMove(status)}
                className={cn(
                  "min-h-7 border border-border px-2 text-xs transition-colors disabled:opacity-50",
                  currentStatusId === status ? "bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                {jobStatusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        To close a job (complete, inactive, or bid refused), change its status on the job page.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </fieldset>
  )
}

/** Links into the job, the same row of buttons in every map panel. */
export function JobLinks({
  jobId,
  links,
}: {
  readonly jobId: string
  /** Secondary pages after "Open job", as [label, path under the job]. */
  readonly links: readonly (readonly [string, string])[]
}): React.ReactElement {
  const base = `/dashboard/projects/${encodeURIComponent(jobId)}`
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <Button asChild className="flex-[1_1_9rem]">
        <Link href={base}>Open job →</Link>
      </Button>
      {links.map(([label, path]) => (
        <Button key={path} asChild variant="outline" className="flex-[1_1_6rem]">
          <Link href={`${base}/${path}`}>{label}</Link>
        </Button>
      ))}
    </div>
  )
}

export function CloseButton({ onClear }: { readonly onClear: () => void }): React.ReactElement {
  return (
    <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClear}>
      <X aria-hidden="true" />
    </Button>
  )
}
