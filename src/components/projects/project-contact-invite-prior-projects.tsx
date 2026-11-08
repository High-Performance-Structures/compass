"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { SourceTag } from "@/components/shared/source-tag"
import type { PriorProject } from "@/lib/domain/contacts/prior-project-access"

/**
 * Projects the invitee could see in Buildertrend. Everything starts ticked so
 * the invite matches their old access; staff untick any project, and
 * staff-only projects (e.g. under a legal hold) can never be ticked.
 */
export function ProjectContactInvitePriorProjects({
  projects,
  selected,
  onSelectedChange,
  disabled,
}: {
  readonly projects: readonly PriorProject[]
  readonly selected: ReadonlySet<string>
  readonly onSelectedChange: (next: ReadonlySet<string>) => void
  readonly disabled: boolean
}): React.ReactElement | null {
  if (projects.length === 0) return null
  const grantable = projects.filter((project) => !project.locked)
  const active = grantable.filter((project) => project.group === "active")
  const closed = grantable.filter((project) => project.group === "closed")
  const locked = projects.filter((project) => project.locked)
  const closedTicked = closed.some((project) => selected.has(project.projectId))

  const toggle = (projectId: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(projectId)
    else next.delete(projectId)
    onSelectedChange(next)
  }
  const setClosed = (checked: boolean): void => {
    const next = new Set(selected)
    for (const project of closed) {
      if (checked) next.add(project.projectId)
      else next.delete(project.projectId)
    }
    onSelectedChange(next)
  }

  const row = (project: PriorProject): React.ReactElement => (
    <label
      key={project.projectId}
      className="flex items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted-foreground"
    >
      <Checkbox
        checked={!project.locked && selected.has(project.projectId)}
        disabled={disabled || project.locked}
        onCheckedChange={(checked) => toggle(project.projectId, checked === true)}
      />
      <span className="min-w-0 flex-1 truncate">{project.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {project.locked ? "Staff-only" : project.buildertrendStatus ?? ""}
      </span>
    </label>
  )

  const group = (
    title: string,
    rows: readonly PriorProject[],
    action?: React.ReactElement,
  ): React.ReactElement | null =>
    rows.length === 0 ? null : (
      <div>
        <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {title} · {rows.length}
          </span>
          {action}
        </div>
        <div>{rows.map(row)}</div>
      </div>
    )

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          Their other projects <SourceTag source="buildertrend" />
        </p>
        <p className="text-xs text-muted-foreground">
          {selected.size} of {grantable.length} ticked
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        They could see these projects before Compass. Ticked projects open with the same invitation.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border">
        {group("Active", active)}
        {group(
          "Closed",
          closed,
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={disabled}
            onClick={() => setClosed(!closedTicked)}
          >
            {closedTicked ? "Untick all closed" : "Tick all closed"}
          </Button>,
        )}
        {group("Not available", locked)}
      </div>
    </div>
  )
}
