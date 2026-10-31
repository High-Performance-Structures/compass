"use client"

import * as React from "react"
import { Pause, Play } from "lucide-react"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import {
  alertActiveBetween,
  alertCovers,
  fireFlags,
  forecastFlags,
  type FireLayerData,
  type WeatherFlag,
  type WeatherFlagKind,
  type WeatherLayerData,
  type WeatherLimits,
} from "@/lib/weather/layer"
import { milesBetween } from "@/lib/weather/geometry"
import { STEP_MS, type CellSeries } from "@/lib/weather/series"

/** Theme token per flag kind, matching the map's colors. */
const FLAG_TOKEN: Readonly<Record<WeatherFlagKind, string>> = {
  snow: "--info",
  rain: "--info",
  wind: "--chart-2",
  cold: "--brand-compass-violet",
  heat: "--warning",
  warning: "--warning",
  fire: "--brand-compass-red",
  red_flag: "--destructive",
}

function stepTime(start: string, step: number): number {
  return Date.parse(start) + step * STEP_MS
}

function stepLabel(start: string, step: number): string {
  if (step === 0) return "Now"
  return new Date(stepTime(start, step)).toLocaleString("en-US", { weekday: "short", hour: "numeric" })
}

/** The time bar under the map: drag or play through the next 48 hours. */
export function WeatherTimeBar({
  start,
  steps,
  step,
  onStep,
}: {
  readonly start: string
  readonly steps: number
  readonly step: number
  readonly onStep: (next: number) => void
}): React.ReactElement {
  const [playing, setPlaying] = React.useState(false)
  const stepRef = React.useRef(step)
  stepRef.current = step
  React.useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => onStep((stepRef.current + 1) % steps), 1200)
    return () => clearInterval(timer)
  }, [onStep, playing, steps])
  const ticks = [0, 4, 8, 12, 16].filter((tick) => tick < steps)
  return (
    <div className="flex items-center gap-3 border border-border bg-background/85 px-2 py-1.5 backdrop-blur">
      <button
        type="button"
        aria-label={playing ? "Pause the forecast" : "Play the forecast"}
        onClick={() => setPlaying((value) => !value)}
        className="flex size-11 shrink-0 items-center justify-center bg-foreground text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <input
          type="range"
          min={0}
          max={steps - 1}
          step={1}
          value={step}
          onChange={(event) => {
            setPlaying(false)
            onStep(Number(event.target.value))
          }}
          aria-label="Forecast time"
          aria-valuetext={stepLabel(start, step)}
          className="h-6 w-full accent-current"
        />
        <div className="relative h-4 font-mono text-xs tracking-[0.08em] text-muted-foreground" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className={tick === 0 ? "absolute whitespace-nowrap" : tick === steps - 1 ? "absolute -translate-x-full whitespace-nowrap" : "absolute -translate-x-1/2 whitespace-nowrap"}
              style={{ left: `${(tick / (steps - 1)) * 100}%` }}
            >
              {tick === 0 ? "NOW" : `+${tick * 3}H`}
            </span>
          ))}
        </div>
      </div>
      <p className="w-24 shrink-0 text-right font-mono text-xs tracking-[0.08em] text-foreground" aria-live="polite">
        {stepLabel(start, step).toUpperCase()}
      </p>
    </div>
  )
}

export type JobWeatherRow = {
  readonly job: PortfolioMapJob
  readonly flags: readonly WeatherFlag[]
}

/** The job's own site forecast, else the nearest map cell within 40 miles. */
function seriesForJob(job: PortfolioMapJob, weather: WeatherLayerData, byProject: ReadonlyMap<string, CellSeries>): CellSeries | null {
  const own = byProject.get(job.id)
  if (own) return own
  if (job.lon === null || job.lat === null) return null
  let best: { readonly series: CellSeries; readonly miles: number } | null = null
  for (const cell of weather.cells) {
    const miles = milesBetween(job.lon, job.lat, cell.lon, cell.lat)
    if (miles <= 40 && (best === null || miles < best.miles)) best = { series: cell.series, miles }
  }
  return best?.series ?? null
}

/** Jobs with weather or fire flags at the selected time, most flags first. */
export function jobWeatherRows(
  jobs: readonly PortfolioMapJob[],
  weather: WeatherLayerData | null,
  fire: FireLayerData | null,
  limits: WeatherLimits,
  step: number,
  nowMs: number,
): JobWeatherRow[] {
  const byProject = new Map((weather?.jobs ?? []).map((entry) => [entry.projectId, entry.series]))
  const from = weather ? stepTime(weather.start, step) : nowMs
  const to = from + 24 * 60 * 60 * 1000
  const rows: JobWeatherRow[] = []
  for (const job of jobs) {
    if (job.lon === null || job.lat === null) continue
    const flags: WeatherFlag[] = []
    if (weather) {
      for (const alert of weather.alerts) {
        if (alert.level === "warning" && alertActiveBetween(alert, from, to) && alertCovers(alert, job.lon, job.lat)) {
          flags.push({ kind: "warning", label: alert.event.toUpperCase(), detail: alert.headline })
        }
      }
      const series = seriesForJob(job, weather, byProject)
      if (series) flags.push(...forecastFlags(series, step, limits))
    }
    if (fire) flags.push(...fireFlags(fire, job.lon, job.lat, limits, nowMs))
    if (flags.length > 0) rows.push({ job, flags })
  }
  return rows.sort((a, b) => b.flags.length - a.flags.length || a.job.name.localeCompare(b.job.name))
}

/** Flag chips for one job, colored like the map. */
export function WeatherFlagChips({ flags }: { readonly flags: readonly WeatherFlag[] }): React.ReactElement {
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag, index) => (
        <span
          key={`${flag.kind}-${index}`}
          className="border px-1.5 py-0.5 font-mono text-xs tracking-[0.06em]"
          style={{ borderColor: `var(${FLAG_TOKEN[flag.kind]})` }}
        >
          {flag.label}
        </span>
      ))}
    </span>
  )
}

/** What the side panel shows while the Weather or Fire & smoke layer is on. */
export type PortfolioWeatherPanelData = {
  readonly title: string
  readonly emptyText: string
  readonly rows: readonly JobWeatherRow[]
}

/** "Weather on your jobs" in the side panel: flagged jobs at the selected time. */
export function WeatherJobsList({
  data,
  onSelectJob,
}: {
  readonly data: PortfolioWeatherPanelData
  readonly onSelectJob: (jobId: string) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
        {data.title} · {data.rows.length}
      </span>
      {data.rows.length === 0 ? <p className="px-1 py-2 text-sm text-muted-foreground">{data.emptyText}</p> : null}
      <ul>
        {data.rows.slice(0, 12).map((row) => (
          <li key={row.job.id}>
            <button
              type="button"
              onClick={() => onSelectJob(row.job.id)}
              className="flex w-full flex-col gap-1 border-b border-border px-1 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">{row.job.name}</span>
                {row.job.town ? <span className="shrink-0 font-mono text-xs tracking-[0.08em] text-muted-foreground">{row.job.town.toUpperCase()}</span> : null}
              </span>
              <WeatherFlagChips flags={row.flags} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The selected job's flags with one sentence each, in its panel. */
export function JobWeatherFlags({ data, jobId }: { readonly data: PortfolioWeatherPanelData; readonly jobId: string }): React.ReactElement | null {
  const row = data.rows.find((item) => item.job.id === jobId)
  if (!row) return null
  return (
    <div className="flex flex-col gap-1.5 border border-border p-3">
      <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">{data.title.replace(" ON YOUR JOBS", "").replace(" NEAR YOUR JOBS", "")}</span>
      <WeatherFlagChips flags={row.flags} />
      <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {row.flags.map((flag, index) => <li key={`${flag.kind}-${index}`}>{flag.detail}</li>)}
      </ul>
    </div>
  )
}
