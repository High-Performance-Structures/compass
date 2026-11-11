"use client"

import * as React from "react"
import { useMapWeatherLayers } from "@/components/dashboard/portfolio-map/use-map-weather-layers"
import { JobWeatherFlags } from "@/components/dashboard/portfolio-map/portfolio-weather-panel"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { MessagesSquare } from "lucide-react"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import {
  AudienceJobPanel,
  type AudiencePanelItem,
  type AudiencePanelLink,
} from "@/components/projects/audience-job-panel"
import { AudienceMapViewButtons, AudiencePipeline, useAudienceMapView } from "@/components/projects/audience-pipeline"
import { useAudiencePreviewHref, useAudiencePreviewReadOnly } from "@/components/projects/project-audience-preview-scope"
import type { PortfolioJobMessages } from "@/components/dashboard/portfolio-map/portfolio-job-messages"
import { useNotificationInbox } from "@/hooks/use-notification-inbox"
import { groupInbox } from "@/lib/notifications/inbox"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"
import { audiencePipelineColumns, ownerPhaseSteps } from "@/lib/portfolio-map/audience-model"
import { phaseForJobStatus, type PortfolioMapJob } from "@/lib/portfolio-map/model"
import { projectAudienceActiveProjectCookieName } from "@/lib/project-audience-active-project"
import { projectAudienceSectionHref } from "@/lib/project-audience-preview-routes"
import { cn } from "@/lib/utils"
import { DEFAULT_MAP_STATE, type MapStateCode } from "@/lib/portfolio-map/states"

// three.js loads only when the map is shown.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[320px]" /> },
)

const MESSAGES_KEY = "compass:owner-map-messages:v1"
const VIEW_KEY = "compass:owner-map-view:v1"

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

const noop = (): void => {}

/**
 * The owner's project on the Colorado relief, zoomed to its town (the pin is
 * the town, never the site), with a side panel of what the owner can act on:
 * stage and progress, unread messages, what's next, the latest update, and
 * the owner workspace's sections. An owner on several jobs sees them all as
 * pins and in the pipeline; picking another one opens it.
 */
export function OwnerSiteRelief({
  job,
  ownerJobs = [],
  progress,
  upcoming,
  latestUpdate,
  links,
  mapState = DEFAULT_MAP_STATE,
}: {
  readonly job: PortfolioMapJob
  /** Every job this owner has, the current one included. */
  readonly ownerJobs?: readonly PortfolioMapJob[]
  /** The contractor's map state. */
  readonly mapState?: MapStateCode
  readonly progress: number | null
  readonly upcoming: readonly AudiencePanelItem[]
  readonly latestUpdate: { readonly title: string; readonly href: string } | null
  readonly links: readonly AudiencePanelLink[]
}): React.ReactElement {
  const router = useRouter()
  const preview = useAudiencePreviewReadOnly()
  const previewHref = useAudiencePreviewHref()
  const [showMap, setShowMap] = React.useState(false)
  const [messagesOn, setMessagesOn] = React.useState(true)

  const hideMap = React.useCallback((): void => setShowMap(false), [])
  const jobs = React.useMemo(
    () => (ownerJobs.some((candidate) => candidate.id === job.id) ? ownerJobs : [job, ...ownerJobs]),
    [job, ownerJobs],
  )
  const placedJobs = React.useMemo(() => jobs.filter((candidate) => candidate.lat !== null && candidate.lon !== null), [jobs])
  const anyPlaced = placedJobs.length > 0
  React.useEffect(() => {
    setShowMap(canShowMap() && anyPlaced)
    setMessagesOn(readMessagesOn())
  }, [anyPlaced])
  const [view, chooseView] = useAudienceMapView(VIEW_KEY, showMap)
  const columns = React.useMemo(() => audiencePipelineColumns("owner", jobs), [jobs])
  const openJob = React.useCallback((jobId: string | null): void => {
    if (!jobId || jobId === job.id) return
    const href = projectAudienceSectionHref(jobId, "owner", "overview")
    // Staff previewing keep the person they're previewing and their own last job.
    if (preview) {
      window.location.assign(previewHref(href))
      return
    }
    document.cookie = `${projectAudienceActiveProjectCookieName("owner")}=${encodeURIComponent(jobId)}; Path=/; Max-Age=31536000; SameSite=Lax`
    router.push(href)
  }, [job.id, preview, previewHref, router])
  const mapWeather = useMapWeatherLayers(placedJobs, showMap)
  const highlight = React.useMemo<SceneHighlight>(
    () => ({ selectedJobId: job.id, hoveredJobId: null, selectedPhase: null }),
    [job.id],
  )

  // Unread items on this project only, checked server-side for the owner.
  const scopes = React.useMemo(() => [{ projectId: job.id, audience: "owner" as const }], [job.id])
  const inbox = useNotificationInbox(true, scopes)
  const projectItems = React.useMemo(() => inbox.items.filter((item) => item.projectId === job.id), [inbox.items, job.id])
  const messageStacks = React.useMemo(
    () => (messagesOn && showMap ? messageStacksFrom(projectItems) : null),
    [messagesOn, projectItems, showMap],
  )
  const { markRead, done } = inbox
  const messages = React.useMemo<PortfolioJobMessages>(() => ({
    rows: groupInbox(projectItems).flatMap((section) => section.rows.filter((row) => row.unreadCount > 0)),
    loaded: inbox.loaded,
    onMarkRead: (row) => void markRead(row),
    onDone: (row) => void done(row),
  }), [done, inbox.loaded, markRead, projectItems])

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

  // A job without a stage (an internal test job) shows its status alone.
  const staged = phaseForJobStatus(job.jobStatusId, job.statusLabel) !== null
  const steps = staged ? ownerPhaseSteps(job.phase) : []
  const current = steps.find((step) => step.state === "current")

  const stage = (
    <section aria-label="Stage" className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
        <p className="mt-1 text-lg font-semibold">{current?.label ?? job.statusLabel}</p>
      </div>
      <ol className="flex flex-wrap gap-x-3 gap-y-1 empty:hidden" aria-label="Project stages">
        {steps.map((step) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              step.state === "upcoming" && "text-muted-foreground",
              step.state === "current" && "font-semibold",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full border",
                step.state === "done" && "border-primary bg-primary",
                step.state === "current" && "border-primary bg-primary/40",
                step.state === "upcoming" && "border-border",
              )}
            />
            {step.label}
          </li>
        ))}
      </ol>
      {progress !== null ? (
        <div>
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Scheduled work complete</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div
            className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Scheduled work complete"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
    </section>
  )

  const panel = (
    <AudienceJobPanel
      heading={
        <div>
          <h3 className="text-base font-semibold leading-snug">{job.name}</h3>
          {job.town ? <p className="text-xs text-muted-foreground">Near {job.town}</p> : null}
        </div>
      }
      stage={stage}
      messages={messages}
      messagesTitle="Unread on your project"
      upcoming={upcoming}
      upcomingEmpty="Your project team hasn't published upcoming work yet."
      latest={latestUpdate ? { label: "Latest update", ...latestUpdate } : null}
      links={links}
    />
  )

  return (
    <section aria-labelledby="owner-relief-title" className="flex w-full flex-col gap-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="owner-relief-title" className="text-lg font-semibold">{jobs.length > 1 ? "Your projects" : "Your project"}</h2>
          {job.town ? (
            <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
              NEAR {job.town.toUpperCase()}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
        {view === "map" ? (
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
            MESSAGES{messages.rows.length > 0 ? ` · ${messages.rows.reduce((sum, row) => sum + row.unreadCount, 0)}` : ""}
          </button>
        ) : null}
        <AudienceMapViewButtons view={view} mapAvailable={showMap} onChange={chooseView} />
        </div>
      </div>
      <div className="flex w-full flex-wrap border border-border">
        {view === "map" ? (
          <div className="h-[30rem] min-w-0 flex-[999_1_32rem]">
            <PortfolioTerrain
              mapState={mapState}
              jobs={placedJobs}
              highlight={highlight}
              onSelectJob={openJob}
              onHoverJob={noop}
              onUnavailable={hideMap}
              focusSelectedOnLoad
              showPhaseKey={false}
              messageStacks={messageStacks}
              layers={mapWeather.layers}
              weather={mapWeather.weather}
            />
          </div>
        ) : (
          <div className="h-[30rem] min-w-0 flex-[999_1_32rem]">
            <AudiencePipeline columns={columns} selectedJobId={job.id} onSelectJob={openJob} />
          </div>
        )}
        <aside
          aria-label="Your project details"
          className="h-[30rem] min-w-0 flex-[1_1_20rem] overflow-y-auto border-l border-border bg-card"
        >
          {mapWeather.panel ? (
            <div className="border-b border-border p-4">
              {mapWeather.panel.rows.length > 0 ? (
                <JobWeatherFlags data={mapWeather.panel} jobId={job.id} />
              ) : (
                <p className="text-sm text-muted-foreground">{mapWeather.panel.emptyText}</p>
              )}
            </div>
          ) : null}
          {panel}
          {view === "map" ? (
            <p className="px-5 pb-4 text-xs text-muted-foreground">The map shows the general area, not the exact site.</p>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
