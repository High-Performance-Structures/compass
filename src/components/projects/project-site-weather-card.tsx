"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { createWeatherRiskTodo, getProjectSiteWeather } from "@/app/actions/project-site-weather"
import { WeatherFlagChips } from "@/components/dashboard/portfolio-map/portfolio-weather-panel"
import { Button } from "@/components/ui/button"
import type { ProjectSiteWeather, SiteWeatherDay } from "@/lib/weather/schedule-risk-server"
import type { ScheduleRiskKind } from "@/lib/weather/schedule-risk"

const RISK_TOKEN: Readonly<Record<ScheduleRiskKind, string>> = {
  cold: "--brand-compass-violet",
  heat: "--warning",
  wind: "--chart-2",
  rain: "--info",
  snow: "--info",
  warning: "--warning",
}

function dayName(date: string, index: number): string {
  if (index === 0) return "Today"
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
}

function dayLine(day: SiteWeatherDay): string {
  const parts: string[] = []
  if (day.snowIn >= 0.1) parts.push(`Snow ${day.snowIn} in`)
  if (day.rainIn >= 0.05) parts.push(`Rain ${day.rainIn.toFixed(2)} in`)
  if (day.gustMph !== null && day.gustMph >= 20) parts.push(`Gusts ${day.gustMph}`)
  return parts.length > 0 ? parts.join(" · ") : "No precipitation"
}

/**
 * Job overview: the site's forecast for the next three days, scheduled work
 * the forecast puts at risk under the company's rules, and warnings or fires
 * nearby. Loads after the page so it never slows the overview.
 */
export function ProjectSiteWeatherCard({ projectId }: { readonly projectId: string }): React.ReactElement | null {
  const [data, setData] = React.useState<ProjectSiteWeather | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [made, setMade] = React.useState<ReadonlySet<string>>(new Set())

  React.useEffect(() => {
    let cancelled = false
    void getProjectSiteWeather(projectId).then((result) => {
      if (!cancelled && result.success) setData(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (!data || data.status === "no_site") return null
  if (data.status === "gathering") {
    return (
      <section aria-label="Site weather" className="mb-4 border p-3">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">Site weather</h2>
        <p className="mt-1 text-xs text-muted-foreground">Gathering this site&apos;s forecast. Check back in a few minutes.</p>
      </section>
    )
  }

  const makeTodo = (key: string, input: { taskId: string; detail: string; dueDate: string }): void => {
    startTransition(async () => {
      const result = await createWeatherRiskTodo(projectId, input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setMade((current) => new Set([...current, key]))
      toast.success("To-do added, linked to the schedule item.")
    })
  }

  const elevation = data.siteElevationFt ?? data.forecastElevationFt
  return (
    <section aria-label="Site weather" className="mb-4 space-y-3 border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">Site weather</h2>
        {elevation !== null ? (
          <span className="font-mono text-xs text-muted-foreground">{elevation.toLocaleString("en-US")} FT</span>
        ) : null}
      </div>
      <ul className="space-y-1">
        {data.days.map((day, index) => (
          <li key={day.date} className="flex items-baseline gap-2 text-sm">
            <span className="w-12 shrink-0 font-medium">{dayName(day.date, index)}</span>
            <span className="w-16 shrink-0 tabular-nums">
              {day.highF ?? "—"}° <span className="text-muted-foreground">/ {day.lowF ?? "—"}°</span>
            </span>
            <span className="min-w-0 text-xs text-muted-foreground">{dayLine(day)}</span>
          </li>
        ))}
      </ul>
      {data.hazards.length > 0 ? (
        <div className="space-y-1">
          <WeatherFlagChips flags={data.hazards} />
          <ul className="text-xs text-muted-foreground">
            {data.hazards.map((flag, index) => <li key={`${flag.kind}-${index}`}>{flag.detail}</li>)}
          </ul>
        </div>
      ) : null}
      {data.risks.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Scheduled work at risk · {data.risks.length}</h3>
          <ul className="space-y-2">
            {data.risks.map((risk) => {
              const key = `${risk.taskId}:${risk.ruleId}:${risk.date}`
              return (
                <li key={key} className="space-y-1.5 border-t pt-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium">{risk.taskTitle}</span>
                    <span className="shrink-0 border px-1.5 py-0.5 font-mono text-xs" style={{ borderColor: `var(${RISK_TOKEN[risk.kind]})` }}>
                      {risk.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{risk.detail}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button asChild size="sm" variant="outline" className="h-8">
                      <Link href={`/dashboard/projects/${projectId}/schedule?item=${encodeURIComponent(risk.taskId)}`}>Open in schedule</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      disabled={pending || made.has(key)}
                      onClick={() => makeTodo(key, { taskId: risk.taskId, detail: risk.detail, dueDate: risk.date })}
                    >
                      {made.has(key) ? "To-do made" : "Make to-do"}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No scheduled work in the next 5 days is over your weather rules.</p>
      )}
      <p className="text-xs text-muted-foreground">
        National Weather Service forecast for the site&apos;s area. Rules: Settings › Workflows › Weather &amp; fire alerts.
      </p>
    </section>
  )
}
