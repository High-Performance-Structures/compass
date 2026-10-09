"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { MessagesSquare } from "lucide-react"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import {
  AudienceJobPanel,
  type AudiencePanelItem,
  type AudiencePanelLink,
} from "@/components/projects/audience-job-panel"
import type { PortfolioJobMessages } from "@/components/dashboard/portfolio-map/portfolio-job-messages"
import { useNotificationInbox } from "@/hooks/use-notification-inbox"
import { groupInbox } from "@/lib/notifications/inbox"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"
import { ownerPhaseSteps } from "@/lib/portfolio-map/audience-model"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import { cn } from "@/lib/utils"

// three.js loads only when the map is shown.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[320px]" /> },
)

const MESSAGES_KEY = "compass:owner-map-messages:v1"

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
 * the owner workspace's sections.
 */
export function OwnerSiteRelief({
  job,
  progress,
  upcoming,
  latestUpdate,
  links,
}: {
  readonly job: PortfolioMapJob
  readonly progress: number | null
  readonly upcoming: readonly AudiencePanelItem[]
  readonly latestUpdate: { readonly title: string; readonly href: string } | null
  readonly links: readonly AudiencePanelLink[]
}): React.ReactElement {
  const [showMap, setShowMap] = React.useState(false)
  const [messagesOn, setMessagesOn] = React.useState(true)
  React.useEffect(() => {
    setShowMap(canShowMap() && job.lat !== null && job.lon !== null)
    setMessagesOn(readMessagesOn())
  }, [job.lat, job.lon])
  const hideMap = React.useCallback((): void => setShowMap(false), [])
  const jobs = React.useMemo(() => [job], [job])
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

  const steps = ownerPhaseSteps(job.phase)
  const current = steps.find((step) => step.state === "current")

  const stage = (
    <section aria-label="Stage" className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
        <p className="mt-1 text-lg font-semibold">{current?.label ?? job.statusLabel}</p>
      </div>
      <ol className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Project stages">
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
          <h2 id="owner-relief-title" className="text-lg font-semibold">Your project</h2>
          {job.town ? (
            <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
              NEAR {job.town.toUpperCase()}
            </span>
          ) : null}
        </div>
        {showMap ? (
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
      </div>
      <div className="flex w-full flex-wrap border border-border">
        {showMap ? (
          <div className="h-[30rem] min-w-0 flex-[999_1_32rem]">
            <PortfolioTerrain
              jobs={jobs}
              highlight={highlight}
              onSelectJob={noop}
              onHoverJob={noop}
              onUnavailable={hideMap}
              focusSelectedOnLoad
              showPhaseKey={false}
              messageStacks={messageStacks}
            />
          </div>
        ) : null}
        <aside
          aria-label="Your project details"
          className={cn("min-w-0 flex-[1_1_20rem] overflow-y-auto bg-card", showMap ? "h-[30rem] border-l border-border" : "")}
        >
          {panel}
          {showMap ? (
            <p className="px-5 pb-4 text-xs text-muted-foreground">The map shows the general area, not the exact site.</p>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
