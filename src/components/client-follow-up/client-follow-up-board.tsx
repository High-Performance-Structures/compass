"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconExternalLink, IconMessagePlus, IconSearch, IconTrophy } from "@tabler/icons-react"
import type { ClientFollowUpJob, ClientFollowUpWorkspace } from "@/app/actions/client-follow-up"
import { getProjectInteractionFormOptions, type ProjectInteractionFormOptions } from "@/app/actions/project-profile"
import { StackedTowers, type Tower } from "@/components/client-follow-up/stacked-towers"
import { ClientInteractionForm } from "@/components/projects/client-interaction-form"
import { FollowUpSection, followUpSummary } from "@/components/projects/project-follow-up-aging"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SortableTh, useTableSort } from "@/components/ui/sortable-header"
import {
  CLIENT_FOLLOW_UP_PERIODS,
  CLIENT_FOLLOW_UP_PERIOD_LABEL,
  type ClientFollowUpPeriod,
} from "@/lib/client-follow-up/leaderboard"
import { PROJECT_AGING_LEVELS, type ProjectAgingLevel } from "@/lib/project-follow-up"
import { cn } from "@/lib/utils"

/** Interaction types mapped to theme chart tokens so towers follow the active theme. */
const TYPE_TOKEN: Readonly<Record<string, string>> = {
  call: "--chart-1",
  email: "--chart-2",
  sms: "--chart-3",
  meeting: "--chart-4",
  site_visit: "--chart-5",
  client_send: "--info",
}

function typeToken(type: string): string {
  return TYPE_TOKEN[type] ?? "--primary"
}

const LEVEL_RANK: Readonly<Record<ProjectAgingLevel, number>> = { overdue: 0, due: 1, no_contact: 2, scheduled: 3, on_track: 4 }

function jobLabel(job: { readonly name: string; readonly projectNumber: string | null }): string {
  return job.projectNumber ? `${job.projectNumber} · ${job.name}` : job.name
}

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

type JobSortKey = "job" | "level" | "lastContact" | "owner" | "period"

const JOB_SORT: Readonly<Record<JobSortKey, (job: ClientFollowUpJob) => string | number | null>> = {
  job: (job) => jobLabel(job),
  level: (job) => LEVEL_RANK[job.signal.level],
  lastContact: (job) => job.signal.businessDaysSinceLastTouch === null ? Number.MAX_SAFE_INTEGER : -job.signal.businessDaysSinceLastTouch,
  owner: (job) => job.ownerName,
  period: (job) => job.periodInteractions,
}

type OptionsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly options: ProjectInteractionFormOptions }
  | { readonly kind: "error"; readonly error: string }

/** "Log contact" from the page header: pick the job, then the full interaction record. */
function LogContactDialog({
  jobs,
  open,
  onOpenChange,
  initialProjectId,
}: {
  readonly jobs: readonly ClientFollowUpJob[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initialProjectId: string | null
}): React.ReactElement {
  const router = useRouter()
  const [projectId, setProjectId] = React.useState(initialProjectId ?? "")
  const [options, setOptions] = React.useState<OptionsState>({ kind: "idle" })
  const [formKey, setFormKey] = React.useState(0)

  React.useEffect(() => {
    if (open) setProjectId(initialProjectId ?? "")
  }, [initialProjectId, open])

  React.useEffect(() => {
    if (!open || !projectId) {
      setOptions({ kind: "idle" })
      return
    }
    let cancelled = false
    setOptions({ kind: "loading" })
    void getProjectInteractionFormOptions(projectId).then((result) => {
      if (cancelled) return
      setOptions(result.success ? { kind: "ready", options: result.options } : { kind: "error", error: result.error })
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Log client interaction</DialogTitle>
          <DialogDescription>Choose the job, then record who, how, when and what happened.</DialogDescription>
        </DialogHeader>
        <SearchableCombobox
          className="h-9"
          value={projectId}
          onValueChange={setProjectId}
          options={jobs.map((job) => ({ value: job.id, label: jobLabel(job), description: job.clientName ?? undefined }))}
          ariaLabel="Job"
          placeholder="Choose a job"
          searchPlaceholder="Search jobs or clients..."
          emptyMessage="No matching jobs."
        />
        {options.kind === "ready" && projectId ? (
          <ClientInteractionForm
            key={`${projectId}-${formKey}`}
            projectId={projectId}
            idPrefix="crm-log"
            options={options.options}
            onCancel={() => onOpenChange(false)}
            onLogged={() => {
              setFormKey((value) => value + 1)
              onOpenChange(false)
              router.refresh()
            }}
          />
        ) : options.kind === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading client contacts…</p>
        ) : options.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">{options.error}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Client follow-up: every followed-up job's aging, the team's logged client
 * contact (leaderboard), job towers that make neglected jobs obvious, and the
 * activity feed. Clicking a person or job filters everything below it.
 */
export function ClientFollowUpBoard({
  workspace,
  initialJobId = null,
}: {
  readonly workspace: ClientFollowUpWorkspace
  /** Preselected job, e.g. from the dashboard map's "Client follow-up" link. */
  readonly initialJobId?: string | null
}): React.ReactElement {
  const router = useRouter()
  const [personId, setPersonId] = React.useState<string | null>(null)
  const [jobId, setJobId] = React.useState<string | null>(
    initialJobId && workspace.jobs.some((job) => job.id === initialJobId) ? initialJobId : null,
  )
  const [levelFilter, setLevelFilter] = React.useState<"attention" | "all">("attention")
  const [query, setQuery] = React.useState("")
  const [logOpen, setLogOpen] = React.useState(false)
  const { settings } = workspace

  const counts = React.useMemo(() => {
    const result: Record<ProjectAgingLevel, number> = { overdue: 0, due: 0, no_contact: 0, scheduled: 0, on_track: 0 }
    for (const job of workspace.jobs) result[job.signal.level] += 1
    return result
  }, [workspace.jobs])

  const leaderId = settings.highlightLeader ? workspace.leaderboard[0]?.userId ?? null : null
  const typeLabels = React.useMemo(() => {
    const labels = new Map<string, string>()
    for (const item of workspace.interactions) labels.set(item.interactionType, item.interactionTypeLabel)
    return labels
  }, [workspace.interactions])

  const leaderboardTowers: readonly Tower[] = workspace.leaderboard.map((entry) => ({
    id: entry.userId,
    label: entry.name,
    sublabel: entry.userId === workspace.viewerId ? "You" : undefined,
    highlight: entry.userId === leaderId && entry.total > 0,
    badge: settings.streaksEnabled && entry.streakDays >= 2 ? `${entry.streakDays}-day streak` : entry.userId === leaderId && entry.total > 0 ? "Leading" : undefined,
    segments: Object.entries(entry.byType).map(([type, value]) => ({ key: type, label: typeLabels.get(type) ?? type, value, colorToken: typeToken(type) })),
  }))

  const jobsByUrgency = [...workspace.jobs].sort(
    (a, b) => LEVEL_RANK[a.signal.level] - LEVEL_RANK[b.signal.level] || (b.signal.businessDaysSinceLastTouch ?? 999) - (a.signal.businessDaysSinceLastTouch ?? 999),
  )
  const jobTowers: readonly Tower[] = jobsByUrgency.slice(0, 40).map((job) => ({
    id: job.id,
    label: job.projectNumber ?? job.name,
    sublabel: PROJECT_AGING_LEVELS[job.signal.level].label,
    // Neglected jobs still show a short red stub so they stand out.
    minHeight: 10,
    segments: [{ key: "contacts", label: "logged contacts", value: job.periodInteractions, colorToken: PROJECT_AGING_LEVELS[job.signal.level].colorToken }],
  }))

  const normalizedQuery = query.trim().toLowerCase()
  const listedJobs = workspace.jobs.filter((job) => {
    if (jobId && job.id !== jobId) return false
    if (levelFilter === "attention" && !jobId && !["overdue", "due", "no_contact"].includes(job.signal.level)) return false
    if (personId && job.ownerUserId !== personId && !workspace.interactions.some((item) => item.projectId === job.id && item.createdBy === personId)) return false
    if (!normalizedQuery) return true
    return `${jobLabel(job)} ${job.clientName ?? ""} ${job.ownerName ?? ""}`.toLowerCase().includes(normalizedQuery)
  })
  const { rows: sortedJobs, sort, toggle } = useTableSort<ClientFollowUpJob, JobSortKey>(listedJobs, JOB_SORT, { key: "level", direction: "asc" })

  const feed = workspace.interactions.filter((item) => {
    if (personId && item.createdBy !== personId) return false
    if (jobId && item.projectId !== jobId) return false
    if (!normalizedQuery) return true
    return `${item.projectLabel} ${item.summary} ${item.createdByName ?? ""} ${item.contactName ?? ""}`.toLowerCase().includes(normalizedQuery)
  })
  const selectedJob = jobId ? workspace.jobs.find((job) => job.id === jobId) ?? null : null
  const selectedPerson = personId ? workspace.leaderboard.find((entry) => entry.userId === personId) ?? null : null

  function setPeriod(period: ClientFollowUpPeriod): void {
    router.push(`/dashboard/client-follow-up?period=${period}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Period">
          {CLIENT_FOLLOW_UP_PERIODS.map((period) => (
            <Button key={period} type="button" role="tab" aria-selected={workspace.period === period} size="sm"
              variant={workspace.period === period ? "secondary" : "ghost"} onClick={() => setPeriod(period)}>
              {CLIENT_FOLLOW_UP_PERIOD_LABEL[period]}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs, clients, notes" className="h-8 pl-8" aria-label="Search client follow-up" />
        </div>
        <Button type="button" size="sm" onClick={() => setLogOpen(true)}>
          <IconMessagePlus className="size-4" />
          Log contact
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {([
          { level: "overdue", label: "Overdue" },
          { level: "due", label: "Follow-up due" },
          { level: "no_contact", label: "No contact logged" },
        ] as const).map((item) => (
          <button key={item.level} type="button" onClick={() => { setJobId(null); setLevelFilter("attention") }}
            className="flex flex-col items-start border-l-4 pl-3 text-left" style={{ borderColor: `var(${PROJECT_AGING_LEVELS[item.level].colorToken})` }}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{counts[item.level]}</dd>
          </button>
        ))}
        <div className="flex flex-col border-l-4 border-l-primary pl-3">
          <dt className="text-xs text-muted-foreground">Logged {CLIENT_FOLLOW_UP_PERIOD_LABEL[workspace.period].toLowerCase()}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{workspace.interactions.length}</dd>
        </div>
      </dl>

      <div className={cn("grid gap-6", settings.leaderboardEnabled && "xl:grid-cols-2")}>
        {settings.leaderboardEnabled ? (
          <section aria-labelledby="crm-leaderboard" className="space-y-2">
            <div className="flex items-center gap-2">
              <IconTrophy className="size-4 text-primary" />
              <h2 id="crm-leaderboard" className="font-semibold">Team client contact</h2>
              <span className="text-xs text-muted-foreground">{CLIENT_FOLLOW_UP_PERIOD_LABEL[workspace.period]}</span>
            </div>
            <StackedTowers towers={leaderboardTowers} activeId={personId} onSelect={setPersonId} ariaLabel="Logged client contact by person"
              emptyMessage="No client contact logged yet this period. The first logged call takes the lead." />
          </section>
        ) : null}
        <section aria-labelledby="crm-job-towers" className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 id="crm-job-towers" className="font-semibold">Jobs by follow-up</h2>
            <span className="text-xs text-muted-foreground">Height is logged contact {CLIENT_FOLLOW_UP_PERIOD_LABEL[workspace.period].toLowerCase()}; red is overdue</span>
          </div>
          <StackedTowers towers={jobTowers} activeId={jobId} onSelect={setJobId} ariaLabel="Jobs by follow-up level"
            emptyMessage="No jobs currently need client follow-up." />
        </section>
      </div>

      {selectedJob || selectedPerson ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing</span>
          {selectedPerson ? <Button size="sm" variant="secondary" onClick={() => setPersonId(null)}>{selectedPerson.name} ✕</Button> : null}
          {selectedJob ? <Button size="sm" variant="secondary" onClick={() => setJobId(null)}>{jobLabel(selectedJob)} ✕</Button> : null}
        </div>
      ) : null}

      {selectedJob ? (
        <section aria-labelledby="crm-selected-job" className="grid gap-4 rounded-lg border-l-4 bg-muted/30 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
          style={{ borderLeftColor: `var(${PROJECT_AGING_LEVELS[selectedJob.signal.level].colorToken})` }}>
          <div className="space-y-1">
            <h2 id="crm-selected-job" className="text-lg font-semibold">{jobLabel(selectedJob)}</h2>
            <p className="text-sm text-muted-foreground">{[selectedJob.clientName, selectedJob.jobStatusLabel, selectedJob.ownerName ? `Owner: ${selectedJob.ownerName}` : "No follow-up owner"].filter(Boolean).join(" · ")}</p>
            <div className="max-w-md pt-2">
              <FollowUpSection projectId={selectedJob.id} signal={selectedJob.signal} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/projects/${encodeURIComponent(selectedJob.id)}/information#log-client-interaction`}>Information and history</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard?job=${encodeURIComponent(selectedJob.id)}`}>Show on map</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard?job=${encodeURIComponent(selectedJob.id)}&view=pipeline`}>Show in pipeline</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/projects/${encodeURIComponent(selectedJob.id)}`}>
                Open job <IconExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="crm-jobs" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="crm-jobs" className="font-semibold">{levelFilter === "attention" && !jobId ? "Needs follow-up" : "All followed jobs"}</h2>
            <span className="text-xs text-muted-foreground">{sortedJobs.length}</span>
            {!jobId ? (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setLevelFilter(levelFilter === "attention" ? "all" : "attention")}>
                {levelFilter === "attention" ? "Show all followed jobs" : "Show only jobs needing follow-up"}
              </Button>
            ) : null}
          </div>
          {sortedJobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing needs follow-up here. Every job has recent client contact.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <SortableTh sortKey="job" sort={sort} onSort={toggle} className="py-2 pr-3 font-medium">Job</SortableTh>
                    <SortableTh sortKey="level" sort={sort} onSort={toggle} className="py-2 pr-3 font-medium">Follow-up</SortableTh>
                    <SortableTh sortKey="lastContact" sort={sort} onSort={toggle} className="py-2 pr-3 font-medium">Last contact</SortableTh>
                    <SortableTh sortKey="owner" sort={sort} onSort={toggle} className="py-2 pr-3 font-medium">Owner</SortableTh>
                    <SortableTh sortKey="period" sort={sort} onSort={toggle} align="right" className="py-2 text-right font-medium">Logged</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedJobs.map((job) => {
                    const level = PROJECT_AGING_LEVELS[job.signal.level]
                    return (
                      <tr key={job.id} className={cn("cursor-pointer border-b hover:bg-muted/40", job.id === jobId && "bg-muted")} onClick={() => setJobId(job.id === jobId ? null : job.id)}>
                        <td className="py-2 pr-3">
                          <span className="font-medium">{jobLabel(job)}</span>
                          {job.clientName ? <span className="block text-xs text-muted-foreground">{job.clientName}</span> : null}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="border px-1.5 py-0.5 text-xs" style={{ borderColor: `var(${level.colorToken})`, color: `var(${level.colorToken})` }}>{level.label}</span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{followUpSummary(job.signal)}</td>
                        <td className="py-2 pr-3 text-xs">{job.ownerName ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums">{job.periodInteractions}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="crm-feed" className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 id="crm-feed" className="font-semibold">Client interactions</h2>
            <span className="text-xs text-muted-foreground">{feed.length}</span>
          </div>
          {feed.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No logged client interactions match this view.</p>
          ) : (
            <ol className="divide-y border-y">
              {feed.slice(0, 150).map((item) => (
                <li key={item.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="size-2 shrink-0" style={{ background: `var(${typeToken(item.interactionType)})` }} aria-hidden />
                    <span className="font-medium text-foreground">{item.interactionTypeLabel}</span>
                    <span>{item.direction === "inbound" ? "from" : "to"} {item.contactName ?? "client"}</span>
                    <span>·</span>
                    <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setJobId(item.projectId)}>{item.projectLabel}</button>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm">{item.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.createdByName ?? "Compass"} · {when(item.occurredAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <LogContactDialog jobs={jobsByUrgency} open={logOpen} onOpenChange={setLogOpen} initialProjectId={jobId} />
    </div>
  )
}
