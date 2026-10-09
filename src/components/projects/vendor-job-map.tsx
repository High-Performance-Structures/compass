"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { getVendorJobScope } from "@/app/actions/portfolio-map"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import { formatDateKeyShort } from "@/components/dashboard/portfolio-map/portfolio-dates"
import { phaseColor } from "@/components/dashboard/portfolio-map/portfolio-style"
import { Button } from "@/components/ui/button"
import { projectAudienceActiveProjectCookieName } from "@/lib/project-audience-active-project"
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

/**
 * "Your jobs" for a sub/vendor: their assigned jobs on the Colorado relief,
 * with their own scope for the selected job. Jobs come from the viewer's
 * project switcher, so nothing here is new to them.
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
  const [selectedId, setSelectedId] = React.useState<string>(
    jobs.some((job) => job.id === currentProjectId) ? currentProjectId : (jobs[0]?.id ?? ""),
  )
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [scopes, setScopes] = React.useState<Readonly<Record<string, ScopeState>>>({})

  React.useEffect(() => {
    setShowMap(canShowMap())
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
  const openJob = (jobId: string): void => {
    const cookieName = projectAudienceActiveProjectCookieName("sub-vendor")
    document.cookie = `${cookieName}=${encodeURIComponent(jobId)}; Path=/; Max-Age=31536000; SameSite=Lax`
    router.push(projectAudienceSectionHref(jobId, "sub-vendor", "overview"))
  }

  return (
    <section aria-labelledby="vendor-jobs-title" className="flex w-full flex-col gap-3 border-b py-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="vendor-jobs-title" className="text-sm font-semibold">Your jobs</h2>
        <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
          {jobs.length} ASSIGNED
        </span>
      </div>
      <div className="flex w-full flex-wrap border border-border">
        {showMap && placed.length > 0 ? (
          <div className="h-[27rem] min-w-0 flex-[999_1_32rem]">
            <PortfolioTerrain
              jobs={placed}
              highlight={highlight}
              onSelectJob={selectJob}
              onHoverJob={setHoveredId}
              onUnavailable={hideMap}
            />
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-[1_1_18rem] flex-col overflow-y-auto bg-card",
            showMap && placed.length > 0 ? "h-[27rem] border-l border-border" : "max-h-[27rem]",
          )}
        >
          {selected ? (
            <div className="border-b border-border p-4">
              <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
                {selected.town ?? "Location not set"}
              </p>
              <h3 className="mt-1 font-semibold leading-snug">{selected.name}</h3>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: phaseColor(selected.phase) }} />
                {PHASE_LABEL.get(selected.phase) ?? selected.statusLabel}
              </p>
              <div className="mt-3 text-sm">
                {scope?.kind === "ready" ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your next items</p>
                    {scope.scope.upcoming.length > 0 ? (
                      <ul className="mt-1 grid gap-1">
                        {scope.scope.upcoming.map((item) => (
                          <li key={item.id} className="flex min-w-0 justify-between gap-3">
                            <span className="min-w-0 truncate">{item.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDateKeyShort(item.startDate)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Nothing scheduled for you yet.</p>
                    )}
                    {scope.scope.commitmentCount > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {scope.scope.commitmentCount} commitment{scope.scope.commitmentCount === 1 ? "" : "s"} on this job
                      </p>
                    ) : null}
                  </>
                ) : scope?.kind === "error" ? (
                  <p className="text-xs text-muted-foreground">{scope.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Loading your scope…</p>
                )}
              </div>
              {selected.id !== currentProjectId ? (
                <Button size="sm" className="mt-3" onClick={() => openJob(selected.id)}>
                  Open this job
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">You&apos;re viewing this job.</p>
              )}
            </div>
          ) : null}
          <ul aria-label="Assigned jobs">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  aria-pressed={job.id === selectedId}
                  onClick={() => setSelectedId(job.id)}
                  onMouseEnter={() => setHoveredId(job.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border px-4 py-2 text-left text-sm hover:bg-accent",
                    job.id === selectedId && "bg-accent",
                  )}
                >
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: phaseColor(job.phase) }} />
                  <span className="min-w-0 flex-1 truncate">{job.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{job.town ?? "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
