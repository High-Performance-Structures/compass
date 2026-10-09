"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { MessagesSquare } from "lucide-react"
import { getVendorJobScope } from "@/app/actions/portfolio-map"
import type { PortfolioJobMessages } from "@/components/dashboard/portfolio-map/portfolio-job-messages"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import { formatDateKeyShort } from "@/components/dashboard/portfolio-map/portfolio-dates"
import { phaseColor } from "@/components/dashboard/portfolio-map/portfolio-style"
import { AudienceJobPanel } from "@/components/projects/audience-job-panel"
import { Button } from "@/components/ui/button"
import { useNotificationInbox } from "@/hooks/use-notification-inbox"
import { groupInbox } from "@/lib/notifications/inbox"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"
import { projectAudienceActiveProjectCookieName } from "@/lib/project-audience-active-project"
import { audienceQuickLinks } from "@/lib/project-audience-links"
import { projectAudienceSectionHref } from "@/lib/project-audience-preview-routes"
import { PORTFOLIO_PHASES, type PortfolioMapJob } from "@/lib/portfolio-map/model"
import type { VendorJobScope } from "@/lib/portfolio-map/audience-model"
import { cn } from "@/lib/utils"

// three.js loads only when the map is shown.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[320px]" /> },
)

const PHASE_LABEL = new Map<string, string>(PORTFOLIO_PHASES.map((phase) => [phase.id, phase.label]))
const MESSAGES_KEY = "compass:vendor-map-messages:v1"

type ScopeState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly scope: VendorJobScope }
  | { readonly kind: "error"; readonly message: string }

function canShowMap(): boolean {
  if (typeof window.matchMedia !== "function") return false
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const narrow = window.matchMedia("(max-width: 767px)").matches
  return !reducedMotion && !narrow
}

function readMessagesOn(): boolean {
  try {
    return window.localStorage.getItem(MESSAGES_KEY) !== "off"
  } catch {
    return true
  }
}

/**
 * "Your jobs" for a sub/vendor: their assigned jobs on the Colorado relief.
 * Clicking a job opens a panel with that job's unread messages, the vendor's
 * next items and commitments, and links into the vendor workspace. Jobs come
 * from the viewer's project switcher, and messages are fetched per job with
 * the vendor audience, so nothing here is new to them.
 */
export function VendorJobMap({
  jobs,
  currentProjectId,
}: {
  readonly jobs: readonly PortfolioMapJob[]
  readonly currentProjectId: string
}): React.ReactElement | null {
  const router = useRouter()
  const [showMap, setShowMap] = React.useState(false)
  const [messagesOn, setMessagesOn] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string>(
    jobs.some((job) => job.id === currentProjectId) ? currentProjectId : (jobs[0]?.id ?? ""),
  )
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [scopes, setScopes] = React.useState<Readonly<Record<string, ScopeState>>>({})

  React.useEffect(() => {
    setShowMap(canShowMap())
    setMessagesOn(readMessagesOn())
  }, [])

  React.useEffect(() => {
    if (!selectedId || scopes[selectedId]) return
    setScopes((current) => ({ ...current, [selectedId]: { kind: "loading" } }))
    void getVendorJobScope(selectedId).then((result) => {
      setScopes((current) => ({
        ...current,
        [selectedId]: result.success
          ? { kind: "ready", scope: result.scope }
          : { kind: "error", message: result.error },
      }))
    })
  }, [scopes, selectedId])

  // Each job's unread items, checked server-side with the vendor audience.
  const inboxScopes = React.useMemo(
    () => jobs.map((job) => ({ projectId: job.id, audience: "sub_vendor" as const })),
    [jobs],
  )
  const inbox = useNotificationInbox(jobs.length > 0, inboxScopes)
  const messageStacks = React.useMemo(
    () => (messagesOn && showMap ? messageStacksFrom(inbox.items) : null),
    [inbox.items, messagesOn, showMap],
  )
  const unreadByJob = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of inbox.items) {
      if (item.readAt === null && item.projectId) counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1)
    }
    return counts
  }, [inbox.items])
  const { markRead, done } = inbox
  const selectedMessages = React.useMemo<PortfolioJobMessages | null>(() => {
    if (!selectedId) return null
    return {
      rows: groupInbox(inbox.items.filter((item) => item.projectId === selectedId))
        .flatMap((section) => section.rows.filter((row) => row.unreadCount > 0)),
      loaded: inbox.loaded,
      onMarkRead: (row) => void markRead(row),
      onDone: (row) => void done(row),
    }
  }, [done, inbox.items, inbox.loaded, markRead, selectedId])

  const selectJob = React.useCallback((jobId: string | null): void => {
    if (jobId) setSelectedId(jobId)
  }, [])
  const hideMap = React.useCallback((): void => setShowMap(false), [])
  const highlight = React.useMemo<SceneHighlight>(
    () => ({ selectedJobId: selectedId || null, hoveredJobId: hoveredId, selectedPhase: null }),
    [hoveredId, selectedId],
  )

  if (jobs.length === 0) return null

  const placed = jobs.filter((job) => job.lat !== null && job.lon !== null)
  const selected = jobs.find((job) => job.id === selectedId) ?? null
  const scope = selected ? scopes[selected.id] : undefined
  const totalUnread = [...unreadByJob.values()].reduce((sum, count) => sum + count, 0)
  const openJob = (jobId: string): void => {
    const cookieName = projectAudienceActiveProjectCookieName("sub-vendor")
    document.cookie = `${cookieName}=${encodeURIComponent(jobId)}; Path=/; Max-Age=31536000; SameSite=Lax`
    router.push(projectAudienceSectionHref(jobId, "sub-vendor", "overview"))
  }
  const toggleMessages = (): void => {
    setMessagesOn((current) => {
      const next = !current
      try {
        window.localStorage.setItem(MESSAGES_KEY, next ? "on" : "off")
      } catch {
        // The choice still applies to this visit.
      }
      return next
    })
  }

  return (
    <section aria-labelledby="vendor-jobs-title" className="flex w-full flex-col gap-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="vendor-jobs-title" className="text-lg font-semibold">Your jobs</h2>
          <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            {jobs.length} ASSIGNED
          </span>
        </div>
        {showMap && placed.length > 0 ? (
          <button
            type="button"
            aria-pressed={messagesOn}
            onClick={toggleMessages}
            className={cn(
              "flex min-h-8 items-center gap-2 border border-border px-3 font-mono text-xs tracking-[0.12em] transition-colors",
              messagesOn ? "bg-foreground text-background" : "bg-card hover:bg-accent",
            )}
          >
            <MessagesSquare className="size-3.5" aria-hidden="true" />
            MESSAGES{totalUnread > 0 ? ` · ${totalUnread}` : ""}
          </button>
        ) : null}
      </div>
      <div className="flex w-full flex-wrap border border-border">
        {showMap && placed.length > 0 ? (
          <div className="h-[30rem] min-w-0 flex-[999_1_32rem]">
            <PortfolioTerrain
              jobs={placed}
              highlight={highlight}
              onSelectJob={selectJob}
              onHoverJob={setHoveredId}
              onUnavailable={hideMap}
              messageStacks={messageStacks}
            />
          </div>
        ) : null}
        <aside
          aria-label="Job details"
          className={cn(
            "flex min-w-0 flex-[1_1_20rem] flex-col overflow-y-auto bg-card",
            showMap && placed.length > 0 ? "h-[30rem] border-l border-border" : "max-h-[30rem]",
          )}
        >
          {selected ? (
            <AudienceJobPanel
              heading={
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
                    {selected.town ?? "Location not set"}
                  </p>
                  <h3 className="text-base font-semibold leading-snug">{selected.name}</h3>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: phaseColor(selected.phase) }} />
                    {PHASE_LABEL.get(selected.phase) ?? selected.statusLabel}
                  </p>
                  {selected.id !== currentProjectId ? (
                    <Button size="sm" className="mt-2 self-start" onClick={() => openJob(selected.id)}>
                      Open this job
                    </Button>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">You&apos;re viewing this job.</p>
                  )}
                </div>
              }
              messages={selectedMessages}
              upcoming={
                scope?.kind === "ready"
                  ? scope.scope.upcoming.map((item) => ({ id: item.id, title: item.title, when: formatDateKeyShort(item.startDate) }))
                  : scope?.kind === "error"
                    ? []
                    : null
              }
              upcomingEmpty={scope?.kind === "error" ? scope.message : "Nothing scheduled for you yet."}
              latest={
                scope?.kind === "ready" && scope.scope.commitmentCount > 0
                  ? {
                      label: "Commitments",
                      title: `${scope.scope.commitmentCount} commitment${scope.scope.commitmentCount === 1 ? "" : "s"} on this job`,
                      href: projectAudienceSectionHref(selected.id, "sub-vendor", "commitments"),
                    }
                  : null
              }
              links={audienceQuickLinks({ owner: false, warrantyEnabled: false }).map((link) => ({
                label: link.label,
                href: projectAudienceSectionHref(selected.id, "sub-vendor", link.section),
              }))}
            />
          ) : null}
          <ul aria-label="Assigned jobs" className="border-t">
            {jobs.map((job) => {
              const unread = unreadByJob.get(job.id) ?? 0
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    aria-pressed={job.id === selectedId}
                    onClick={() => setSelectedId(job.id)}
                    onMouseEnter={() => setHoveredId(job.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border px-5 py-2 text-left text-sm hover:bg-accent",
                      job.id === selectedId && "bg-accent",
                    )}
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: phaseColor(job.phase) }} />
                    <span className="min-w-0 flex-1 truncate">{job.name}</span>
                    {unread > 0 ? <span className="shrink-0 text-xs font-medium text-primary">{unread} new</span> : null}
                    <span className="shrink-0 text-xs text-muted-foreground">{job.town ?? "—"}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </section>
  )
}
