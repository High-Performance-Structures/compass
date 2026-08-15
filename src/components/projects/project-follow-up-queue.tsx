"use client"

import Link from "next/link"
import { useMemo, useState, type ReactElement } from "react"

import type { ProjectFollowUpQueueItem } from "@/app/actions/project-profile"
import { Badge } from "@/components/ui/badge"

const STATE_LABELS: Readonly<Record<ProjectFollowUpQueueItem["state"], string>> = {
  overdue: "Overdue",
  due: "Due",
  unrecorded: "No touch recorded",
  current: "Current",
  scheduled: "Scheduled",
}

function followUpStateFilter(
  value: string,
): "all" | ProjectFollowUpQueueItem["state"] | null {
  if (value === "all") return value
  if (value === "overdue" || value === "due" || value === "unrecorded" || value === "current" || value === "scheduled") {
    return value
  }
  return null
}

function clientStatusFilter(value: string): "all" | "lead" | "customer" | null {
  if (value === "all" || value === "lead" || value === "customer") return value
  return null
}

function stateVariant(state: ProjectFollowUpQueueItem["state"]): "default" | "secondary" | "destructive" | "outline" {
  if (state === "overdue") return "destructive"
  if (state === "due" || state === "unrecorded") return "secondary"
  if (state === "scheduled") return "outline"
  return "default"
}

function lastTouchLabel(item: ProjectFollowUpQueueItem): string {
  if (item.businessDaysSinceLastTouch === null) return "No recorded client touch"
  const unit = item.businessDaysSinceLastTouch === 1 ? "business day" : "business days"
  return `${item.businessDaysSinceLastTouch} ${unit} ago`
}

export function ProjectFollowUpQueue({
  items,
}: {
  readonly items: readonly ProjectFollowUpQueueItem[]
}): ReactElement {
  const [stateFilter, setStateFilter] = useState<"all" | ProjectFollowUpQueueItem["state"]>("all")
  const [clientFilter, setClientFilter] = useState<"all" | "lead" | "customer">("all")
  const [jobStatusFilter, setJobStatusFilter] = useState("all")
  const jobStatuses = useMemo(
    () => [...new Set(items.map((item) => item.jobStatusLabel))].sort((left, right) => left.localeCompare(right)),
    [items],
  )
  const filtered = items.filter((item) => {
    return (stateFilter === "all" || item.state === stateFilter)
      && (clientFilter === "all" || item.clientStatus === clientFilter)
      && (jobStatusFilter === "all" || item.jobStatusLabel === jobStatusFilter)
  })

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Client Follow-up</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Active leads and jobs</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Prioritized by meaningful client touch, a staff-set next follow-up, and the governed job-status cadence. Internal technical activity does not reset this clock.</p>
      </div>
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="font-medium">Follow-up state</span><select className="flex h-9 w-full rounded-md border bg-background px-3" value={stateFilter} onChange={(event) => { const next = followUpStateFilter(event.target.value); if (next !== null) setStateFilter(next) }}><option value="all">All states</option>{Object.entries(STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Client status</span><select className="flex h-9 w-full rounded-md border bg-background px-3" value={clientFilter} onChange={(event) => { const next = clientStatusFilter(event.target.value); if (next !== null) setClientFilter(next) }}><option value="all">Leads and customers</option><option value="lead">Leads</option><option value="customer">Customers</option></select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Job status</span><select className="flex h-9 w-full rounded-md border bg-background px-3" value={jobStatusFilter} onChange={(event) => setJobStatusFilter(event.target.value)}><option value="all">All job statuses</option>{jobStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
      </div>
      <p className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "project" : "projects"} shown</p>
      <div className="overflow-hidden rounded-lg border bg-card">
        {filtered.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No active leads or jobs match these filters.</p> : <div className="divide-y">{filtered.map((item) => <Link key={item.projectId} href={`/dashboard/projects/${item.projectId}/information`} className="block p-4 transition-colors hover:bg-muted/50"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{item.projectNumber ? `${item.projectNumber} · ` : ""}{item.projectName}</p><p className="mt-1 text-sm text-muted-foreground">{item.clientName ?? "No client named"} · {item.clientStatus === "lead" ? "Lead" : "Customer"} · {item.jobStatusLabel}</p></div><Badge variant={stateVariant(item.state)}>{STATE_LABELS[item.state]}</Badge></div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><span className="text-muted-foreground">Last client touch: </span>{lastTouchLabel(item)}</p><p><span className="text-muted-foreground">Next follow-up: </span>{item.nextFollowUpAt ? new Date(item.nextFollowUpAt).toLocaleString() : "Status cadence"}</p><p><span className="text-muted-foreground">Owner: </span>{item.followUpOwnerName ?? "Unassigned"}</p></div></Link>)}</div>}
      </div>
    </div>
  )
}
