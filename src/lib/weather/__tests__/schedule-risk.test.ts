import { describe, expect, it } from "vitest"
import { DEFAULT_WEATHER_LIMITS } from "@/lib/weather/layer"
import { addDays, DEFAULT_WEATHER_WORK_RULES, scheduleWeatherRisks } from "@/lib/weather/schedule-risk"
import { dailySummary } from "@/lib/weather/schedule-risk-server"
import type { CellSeries } from "@/lib/weather/series"

// Series start 2026-10-26 06:00 UTC (midnight in Denver); 3-hour steps.
const START = "2026-10-26T06:00:00.000Z"
const NOW = Date.parse("2026-10-26T15:00:00Z")
const localDate = (ms: number): string => new Date(ms - 6 * 60 * 60 * 1000).toISOString().slice(0, 10)

function series(fill: Partial<Record<keyof Omit<CellSeries, "start">, (step: number) => number | null>>): CellSeries {
  const make = (key: keyof Omit<CellSeries, "start">, fallback: number | null) =>
    Array.from({ length: 56 }, (_, step) => (fill[key] ? fill[key](step) : fallback))
  return {
    start: START,
    tempMinF: make("tempMinF", 45),
    tempMaxF: make("tempMaxF", 60),
    precipIn: make("precipIn", 0),
    snowIn: make("snowIn", 0),
    gustMph: make("gustMph", 10),
    windDir: make("windDir", 270),
  }
}

const base = { alerts: [], limits: DEFAULT_WEATHER_LIMITS, rules: DEFAULT_WEATHER_WORK_RULES, localDate, nowMs: NOW }

describe("schedule weather risks", () => {
  it("flags a pour when the cure days after it go below the limit", () => {
    // Cold on Oct 28 (steps 16–23), two days after a one-day pour on Oct 26.
    const cold = series({ tempMinF: (step) => (step >= 16 && step < 24 ? 28 : 45) })
    const risks = scheduleWeatherRisks({ ...base, series: cold, items: [{ id: "t1", title: "Footing pour", startDate: "2026-10-26", endDate: "2026-10-26" }] })
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({ taskId: "t1", ruleId: "pour", kind: "cold", date: "2026-10-28" })
    expect(risks[0]?.detail).toContain("Lows down to 28°F starting Wed, Oct 28")
    expect(risks[0]?.detail).toContain("concrete pours is 40°F")
  })

  it("matches rules by words in the title and checks only the item's days", () => {
    const windy = series({ gustMph: (step) => (step >= 8 && step < 16 ? 42 : 12) })
    const items = [
      { id: "roof", title: "Roof sheathing", startDate: "2026-10-27", endDate: "2026-10-27" },
      { id: "drywall", title: "Drywall hang", startDate: "2026-10-27", endDate: "2026-10-27" },
      { id: "later", title: "Crane pick", startDate: "2026-10-29", endDate: "2026-10-29" },
    ]
    const risks = scheduleWeatherRisks({ ...base, series: windy, items })
    expect(risks.map((risk) => `${risk.taskId}:${risk.ruleId}`)).toEqual(["roof:lifts"])
  })

  it("checks every item for heavy snow, extreme cold and warnings", () => {
    const storm = series({ snowIn: (step) => (step >= 8 && step < 12 ? 2 : 0), precipIn: (step) => (step >= 8 && step < 12 ? 0.2 : 0), tempMinF: (step) => (step === 10 ? -5 : 20) })
    const warning = { id: "w1", event: "Winter Storm Warning", kind: "winter" as const, level: "warning" as const, headline: "Winter Storm Warning until Tue 6 AM", onset: "2026-10-27T06:00:00Z", ends: "2026-10-28T12:00:00Z", rings: [], zoneIds: [] }
    const risks = scheduleWeatherRisks({ ...base, series: storm, alerts: [warning], items: [{ id: "t", title: "Interior trim", startDate: "2026-10-27", endDate: "2026-10-27" }] })
    expect(risks.map((risk) => risk.kind)).toEqual(["snow", "cold", "warning"])
    expect(risks[0]?.detail).toContain("8.0 in of snow")
  })

  it("does not repeat a rule's check as a general check", () => {
    const freezing = series({ tempMinF: () => -10 })
    const risks = scheduleWeatherRisks({ ...base, series: freezing, items: [{ id: "p", title: "Slab pour", startDate: "2026-10-26", endDate: "2026-10-26" }] })
    expect(risks.map((risk) => risk.ruleId)).toEqual(["pour"])
  })

  it("ignores items outside the forecast and past steps", () => {
    const freezing = series({ tempMinF: () => -10 })
    expect(scheduleWeatherRisks({ ...base, series: freezing, items: [{ id: "x", title: "Pour", startDate: "2026-11-20", endDate: "2026-11-20" }] })).toEqual([])
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
  })

  it("summarizes local days", () => {
    const days = dailySummary(series({ snowIn: (step) => (step < 8 ? 0.5 : 0), tempMaxF: (step) => 30 + step }), localDate, "2026-10-26", 3)
    expect(days.map((day) => day.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"])
    expect(days[0]).toMatchObject({ snowIn: 4, highF: 37 })
  })
})
