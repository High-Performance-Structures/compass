"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { PortfolioMarkerKey } from "@/components/dashboard/portfolio-map/portfolio-terrain"
import type { WorkspaceKind } from "@/lib/internal-duties/model"
import type { PortfolioInternalJob } from "@/lib/portfolio-map/load"
import { cn } from "@/lib/utils"

/** The Internal view: the company's own offices and yards, apart from client projects. */
export const INTERNAL_SCOPE = "internal"

const KINDS: readonly { readonly id: WorkspaceKind; readonly label: string; readonly colorToken: string }[] = [
  { id: "office", label: "Office", colorToken: "--chart-1" },
  { id: "executive", label: "Owner's office", colorToken: "--chart-5" },
  { id: "field", label: "Yard and field", colorToken: "--chart-4" },
]

const KIND_BY_ID = new Map(KINDS.map((kind) => [kind.id, kind]))

export function internalMarkerKey(jobs: readonly PortfolioInternalJob[]): PortfolioMarkerKey {
  return {
    entries: KINDS.filter((kind) => jobs.some((job) => job.workspaceKind === kind.id)),
    colorTokenByJobId: new Map(jobs.map((job) => [job.id, KIND_BY_ID.get(job.workspaceKind)?.colorToken ?? "--muted-foreground"])),
  }
}

export function internalSummary(jobs: readonly PortfolioInternalJob[]): string {
  const offices = jobs.filter((job) => job.workspaceKind !== "field").length
  const field = jobs.length - offices
  return `${offices} ${offices === 1 ? "OFFICE" : "OFFICES"} · ${field} FIELD`
}

function Swatch({ kind }: { readonly kind: WorkspaceKind }): React.ReactElement {
  return <span className="size-2 shrink-0" style={{ background: `var(${KIND_BY_ID.get(kind)?.colorToken ?? "--muted-foreground"})` }} aria-hidden="true" />
}

/** The Internal view's list, in place of the pipeline columns. */
export function InternalWorkspaceList({
  jobs,
  selectedId,
  onSelect,
}: {
  readonly jobs: readonly PortfolioInternalJob[]
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto sm:grid-cols-3">
      {KINDS.map((kind) => {
        const kindJobs = jobs.filter((job) => job.workspaceKind === kind.id)
        return (
          <section key={kind.id} aria-label={kind.label} className="flex flex-col border-b border-border sm:border-r sm:border-b-0 sm:last:border-r-0">
            <h3 className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-xs tracking-[0.12em]">
              <span className="flex items-center gap-2">
                <Swatch kind={kind.id} />
                {kind.label.toUpperCase()}
              </span>
              <span className="tabular-nums">{kindJobs.length}</span>
            </h3>
            <ul>
              {kindJobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === job.id}
                    onClick={() => onSelect(job.id)}
                    className={cn("w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-accent", selectedId === job.id && "bg-accent")}
                  >
                    <span className="block font-medium">{job.name}</span>
                    <span className="block text-xs text-muted-foreground">{job.address ?? "No address yet"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** The Internal view's side panel: the selected workspace, or all of them. */
export function InternalMapPanel({
  jobs,
  selectedId,
  onSelect,
}: {
  readonly jobs: readonly PortfolioInternalJob[]
  readonly selectedId: string | null
  readonly onSelect: (id: string | null) => void
}): React.ReactElement {
  const selected = jobs.find((job) => job.id === selectedId) ?? null
  if (selected) {
    const projectHref = `/dashboard/projects/${encodeURIComponent(selected.id)}`
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex items-center gap-2 font-mono text-xs tracking-[0.12em] text-muted-foreground">
              <Swatch kind={selected.workspaceKind} />
              {(KIND_BY_ID.get(selected.workspaceKind)?.label ?? "Internal").toUpperCase()}
            </span>
            <h3 className="text-xl font-semibold">{selected.name}</h3>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Close
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {selected.address ?? "No address yet. Add one on the Information page to place it on the map."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={projectHref}>Open overview</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`${projectHref}/duty-log`}>Duty log</Link>
          </Button>
          {selected.address === null ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`${projectHref}/information`}>Add address</Link>
            </Button>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 p-4">
      <span className="text-sm text-muted-foreground">The company&apos;s offices and yards. Select one on the map or below.</span>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            <button type="button" onClick={() => onSelect(job.id)} className="flex min-h-9 w-full items-center gap-2 border-b border-border px-1 text-left text-sm hover:bg-accent">
              <Swatch kind={job.workspaceKind} />
              <span className="truncate">{job.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
