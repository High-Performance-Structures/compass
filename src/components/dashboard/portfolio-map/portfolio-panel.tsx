"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { EyeOff, X } from "lucide-react"
import { updateProjectMapVisibility } from "@/app/actions/project-profile"
import { listProjectsToAddToMap } from "@/app/actions/portfolio-map"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { formatDateKeyShort } from "@/components/dashboard/portfolio-map/portfolio-dates"
import {
  HEALTH_LABEL,
  healthColor,
  phaseColor,
} from "@/components/dashboard/portfolio-map/portfolio-style"
import {
  PORTFOLIO_PHASES,
  type PortfolioMapJob,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/model"
import type {
  PortfolioAddableProject,
  PortfolioHiddenJob,
  PortfolioJobTravel,
  PortfolioTravelData,
  PortfolioUnplacedJob,
} from "@/lib/portfolio-map/load"
import { formatRateCents, rateLabel } from "@/lib/portfolio-map/travel-zones"
import type { PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"

export type PortfolioSelection =
  | { readonly kind: "none" }
  | { readonly kind: "phase"; readonly phase: PortfolioPhaseId }
  | { readonly kind: "job"; readonly jobId: string }

type PortfolioPanelProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly unplaced: readonly PortfolioUnplacedJob[]
  readonly hidden: readonly PortfolioHiddenJob[]
  /** Office staff only; null hides the zone charge rows. */
  readonly travel: PortfolioTravelData | null
  readonly selection: PortfolioSelection
  readonly onSelectJob: (jobId: string) => void
  readonly onSelectPhase: (phase: PortfolioPhaseId) => void
  readonly onClear: () => void
}

const LABEL = "font-mono text-xs tracking-[0.12em] text-muted-foreground"
const ROW = "flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-1 text-left text-sm transition-colors hover:bg-accent"

function HealthTag({ job }: { readonly job: PortfolioMapJob }): React.ReactElement {
  return (
    <span
      className="shrink-0 border px-1.5 py-0.5 font-mono text-xs tracking-[0.1em]"
      style={{ borderColor: healthColor(job.health), color: healthColor(job.health) }}
    >
      {HEALTH_LABEL[job.health].toUpperCase()}
    </span>
  )
}

/** Save a project's map setting, then reload the dashboard data. */
function useMapVisibility(): {
  readonly pending: boolean
  readonly message: string | null
  readonly change: (projectId: string, visibility: PortfolioMapVisibility, after?: () => void) => void
} {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)
  const change = (projectId: string, visibility: PortfolioMapVisibility, after?: () => void): void => {
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectMapVisibility({ projectId, visibility })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      after?.()
      router.refresh()
    })
  }
  return { pending, message, change }
}

function CloseButton({ onClear }: { readonly onClear: () => void }): React.ReactElement {
  return (
    <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClear}>
      <X aria-hidden="true" />
    </Button>
  )
}

/** Zone and mountain charge rows for one job. */
function TravelRows({
  travel,
  homeLabel,
}: {
  readonly travel: PortfolioJobTravel
  readonly homeLabel: string
}): React.ReactElement {
  const mountain =
    travel.elevationFt === null
      ? travel.siteLookup === "no_address"
        ? "Needs a site address"
        : travel.siteLookup === "not_found"
          ? "Address not found by lookup"
          : "Elevation pending"
      : `${travel.elevationFt.toLocaleString("en-US")} ft${
          travel.mountainBand === null
            ? " · no mountain charge"
            : ` · band ${travel.mountainBand} · ${
                travel.mountainRateCents === null
                  ? "rate not set"
                  : travel.mountainRateCents === 0
                    ? "no charge"
                    : `+${formatRateCents(travel.mountainRateCents)}/man-hr`
              }`
        }`
  return (
    <>
      <dt className="text-muted-foreground">Zone</dt>
      <dd className="text-right">
        <span className="tabular-nums">
          Zone {travel.zone} ·{" "}
          <span className="whitespace-nowrap">
            {travel.zoneRateCents === null || travel.zoneRateCents === 0
              ? rateLabel(travel.zoneRateCents).toLowerCase()
              : `+${formatRateCents(travel.zoneRateCents)}/man-hr`}
          </span>
        </span>
        {travel.lodgingAndPerDiem ? <span className="block text-xs text-muted-foreground">+ lodging and per diem</span> : null}
        {travel.custom.length > 0 ? <span className="block text-xs font-medium text-primary">Custom for this job</span> : null}
        <span className="block text-xs text-muted-foreground">
          {travel.approximate ? "≈" : ""}
          {travel.miles} mi from {homeLabel}
          {travel.approximate ? " (town center)" : ""}
        </span>
      </dd>
      <dt className="text-muted-foreground">Site elevation</dt>
      <dd className="text-right">
        {travel.siteNote && travel.elevationFt !== null && !travel.custom.includes("elevation") ? "≈ " : ""}
        {mountain}
        {travel.siteNote ? <span className="block text-xs text-muted-foreground">{travel.siteNote}</span> : null}
      </dd>
    </>
  )
}

function JobDetail({
  job,
  travel,
  homeLabel,
  onClear,
}: {
  readonly job: PortfolioMapJob
  readonly travel: PortfolioJobTravel | null
  readonly homeLabel: string
  readonly onClear: () => void
}): React.ReactElement {
  const visibility = useMapVisibility()
  const phaseIndex = PORTFOLIO_PHASES.findIndex((phase) => phase.id === job.phase)
  const phaseLabel = PORTFOLIO_PHASES[phaseIndex]?.label ?? job.statusLabel
  const base = `/dashboard/projects/${encodeURIComponent(job.id)}`
  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {job.projectNumber ? <span className={LABEL}>{job.projectNumber}</span> : null}
          <h3 className="text-xl font-semibold leading-tight">{job.name}</h3>
          <span className="text-sm text-muted-foreground">{job.town ? `${job.town}, CO` : "Town not set"}</span>
        </div>
        <CloseButton onClear={onClear} />
      </div>
      <HealthTag job={job} />
      <div className="flex flex-col gap-2">
        <span className={LABEL}>PIPELINE</span>
        <ol className="grid grid-cols-6 gap-1" aria-label={`Phase: ${phaseLabel}`}>
          {PORTFOLIO_PHASES.map((phase, index) => (
            <li key={phase.id} className="flex flex-col gap-1">
              <span
                className="block h-1"
                style={{
                  background:
                    index === phaseIndex
                      ? phaseColor(phase.id)
                      : index < phaseIndex
                        ? "var(--muted-foreground)"
                        : "var(--border)",
                }}
              />
              <span className={index === phaseIndex ? "font-mono text-xs text-foreground" : "font-mono text-xs text-muted-foreground"}>
                {phase.short}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-4">
        <span className={LABEL}>{job.phase === "construction" ? "BUILT" : "SCHEDULE COMPLETE"}</span>
        <span className="text-3xl font-semibold tabular-nums">
          {job.progress === null ? "—" : `${job.progress}%`}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="text-right">{job.statusLabel}</dd>
        <dt className="text-muted-foreground">Next</dt>
        <dd className="text-right">
          {job.nextTaskTitle
            ? `${job.nextTaskTitle}${job.nextTaskStart ? ` · ${formatDateKeyShort(job.nextTaskStart)}` : ""}`
            : "No upcoming schedule items"}
        </dd>
        <dt className="text-muted-foreground">Past due</dt>
        <dd className="text-right" style={job.pastDueCount > 0 ? { color: "var(--destructive)" } : undefined}>
          {job.pastDueCount === 0 ? "None" : `${job.pastDueCount} ${job.pastDueCount === 1 ? "item" : "items"}`}
        </dd>
        {travel ? <TravelRows travel={travel} homeLabel={homeLabel} /> : null}
      </dl>
      {travel ? (
        <Link
          href={`${base}/information#zone-charges`}
          className="-mt-3 self-end text-xs text-primary underline-offset-4 hover:underline"
        >
          {travel.elevationFt === null && travel.siteLookup === "not_found"
            ? "Enter the site elevation for this job"
            : travel.custom.length > 0
              ? "Review zone charges for this job"
              : "Adjust zone charges for this job"}
        </Link>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Button asChild className="flex-[1_1_9rem]">
          <Link href={base}>Open job →</Link>
        </Button>
        <Button asChild variant="outline" className="flex-[1_1_6rem]">
          <Link href={`${base}/schedule`}>Schedule</Link>
        </Button>
        <Button asChild variant="outline" className="flex-[1_1_6rem]">
          <Link href={`${base}/daily-logs`}>Daily logs</Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{job.visibility === "shown" ? "Always shown on the map" : "Shown by its status"}</span>
        <span className="flex gap-1">
          {job.visibility === "shown" ? (
            <Button type="button" variant="ghost" size="sm" disabled={visibility.pending}
              onClick={() => visibility.change(job.id, "default")}>
              Use default
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={visibility.pending}
            onClick={() => visibility.change(job.id, "hidden", onClear)}>
            <EyeOff aria-hidden="true" />
            Hide from map
          </Button>
        </span>
      </div>
      {visibility.message ? <p role="alert" className="text-xs text-destructive">{visibility.message}</p> : null}
    </div>
  )
}

const ADD_RESULT_LIMIT = 8

/**
 * Put a project that its status or department keeps off the map onto it
 * ("Always show"). The list loads the first time this is opened.
 */
function AddToMap(): React.ReactElement {
  const visibility = useMapVisibility()
  const [projects, setProjects] = React.useState<readonly PortfolioAddableProject[] | null>(null)
  const [loading, startLoading] = React.useTransition()
  const [query, setQuery] = React.useState("")
  const [added, setAdded] = React.useState<readonly string[]>([])

  const load = (): void => {
    if (projects !== null || loading) return
    startLoading(async () => {
      setProjects(await listProjectsToAddToMap())
    })
  }

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (projects ?? [])
    .filter((project) => !added.includes(project.id))
    .filter((project) => {
      const haystack = `${project.name} ${project.projectNumber ?? ""} ${project.statusLabel}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })

  return (
    <details
      className="text-xs text-muted-foreground"
      onToggle={(event) => {
        if (event.currentTarget.open) load()
      }}
    >
      <summary className="cursor-pointer py-1 hover:text-foreground">Add a project to the map</summary>
      <div className="mt-2 flex flex-col gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, number or status"
          aria-label="Search projects to add to the map"
          className="h-8 text-xs"
        />
        {projects === null || loading ? (
          <p>Loading projects…</p>
        ) : terms.length === 0 ? (
          <p>{projects.length} projects are off the map by their status. Type to find one.</p>
        ) : matches.length === 0 ? (
          <p>No matching projects.</p>
        ) : (
          <ul>
            {matches.slice(0, ADD_RESULT_LIMIT).map((project) => (
              <li key={project.id} className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-1 text-foreground">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{project.name}</span>
                  <span className="truncate font-mono text-muted-foreground">
                    {project.projectNumber ? `${project.projectNumber} · ` : ""}{project.statusLabel}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={visibility.pending}
                  onClick={() =>
                    visibility.change(project.id, "shown", () => setAdded((ids) => [...ids, project.id]))
                  }
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
        {visibility.message ? <p role="alert" className="text-destructive">{visibility.message}</p> : null}
      </div>
    </details>
  )
}

function HiddenJobs({ hidden }: { readonly hidden: readonly PortfolioHiddenJob[] }): React.ReactElement | null {
  const visibility = useMapVisibility()
  if (hidden.length === 0) return null
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer py-1 hover:text-foreground">
        {hidden.length === 1 ? "1 job is hidden from the map." : `${hidden.length} jobs are hidden from the map.`}
      </summary>
      <ul className="mt-1">
        {hidden.map((job) => (
          <li key={job.id} className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-1 text-foreground">
            <span className="truncate">{job.name}</span>
            <Button type="button" variant="ghost" size="sm" disabled={visibility.pending}
              onClick={() => visibility.change(job.id, job.restoreVisibility)}>
              Show on map
            </Button>
          </li>
        ))}
      </ul>
      {visibility.message ? <p role="alert" className="text-destructive">{visibility.message}</p> : null}
    </details>
  )
}

export function PortfolioPanel({
  jobs,
  unplaced,
  hidden,
  travel,
  selection,
  onSelectJob,
  onSelectPhase,
  onClear,
}: PortfolioPanelProps): React.ReactElement {
  if (selection.kind === "job") {
    const job = jobs.find((item) => item.id === selection.jobId)
    if (job) {
      return (
        <JobDetail
          job={job}
          travel={travel?.byJobId[job.id] ?? null}
          homeLabel={travel?.settings.homeBase.label ?? ""}
          onClear={onClear}
        />
      )
    }
  }

  if (selection.kind === "phase") {
    const phase = PORTFOLIO_PHASES.find((item) => item.id === selection.phase)
    const phaseJobs = jobs.filter((job) => job.phase === selection.phase)
    return (
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>PHASE · {phaseJobs.length} JOBS</span>
            <h3 className="text-xl font-semibold">{phase?.label}</h3>
          </div>
          <CloseButton onClear={onClear} />
        </div>
        <ul>
          {phaseJobs.map((job) => (
            <li key={job.id}>
              <button type="button" className="flex w-full flex-col gap-2 border-b border-border px-1 py-3 text-left transition-colors hover:bg-accent" onClick={() => onSelectJob(job.id)}>
                <span className="flex w-full justify-between gap-3 text-sm">
                  <span>{job.name}</span>
                  <span className="font-mono text-xs tabular-nums">{job.progress === null ? "—" : `${job.progress}%`}</span>
                </span>
                <span className="block h-1 w-full bg-muted">
                  <span className="block h-1" style={{ width: `${job.progress ?? 0}%`, background: phaseColor(job.phase) }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const attention = jobs
    .filter((job) => job.health !== "ok")
    .sort((a, b) => Number(b.health === "late") - Number(a.health === "late") || b.pastDueCount - a.pastDueCount)
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <span className={LABEL}>PIPELINE</span>
        <span className="text-sm text-muted-foreground">Select a job on the map, or a phase below.</span>
      </div>
      <ul>
        {PORTFOLIO_PHASES.map((phase) => (
          <li key={phase.id}>
            <button type="button" className={ROW} onClick={() => onSelectPhase(phase.id)}>
              <span className="flex items-center gap-2.5">
                <span className="size-2.5" style={{ background: phaseColor(phase.id) }} aria-hidden="true" />
                {phase.label}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {jobs.filter((job) => job.phase === phase.id).length}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {attention.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[0.12em]" style={{ color: "var(--destructive)" }}>
            ● NEEDS ATTENTION · {attention.length}
          </span>
          <ul>
            {attention.slice(0, 8).map((job) => (
              <li key={job.id}>
                <button type="button" className={ROW} onClick={() => onSelectJob(job.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{job.name}</span>
                    <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                      {job.town ? job.town.toUpperCase() : "NO TOWN"}
                    </span>
                  </span>
                  <HealthTag job={job} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <HiddenJobs hidden={hidden} />
      <AddToMap />
      {unplaced.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1 hover:text-foreground">
            {unplaced.length === 1
              ? "1 job is not on the map yet: it needs a site address with a town."
              : `${unplaced.length} jobs are not on the map yet: they need a site address with a town.`}
          </summary>
          <ul className="mt-1">
            {unplaced.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/dashboard/projects/${encodeURIComponent(job.id)}/information`}
                  className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-1 text-foreground hover:bg-accent"
                >
                  <span className="truncate">{job.name}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{job.projectNumber ?? "Add address →"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
