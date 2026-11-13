import { describe, expect, it } from "vitest"

import {
  jobsDueAt,
  SCHEDULED_JOBS,
  scheduledEveryMinutes,
} from "@/lib/operations/schedule"

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 9, 15, minute))
}

function namesAt(minute: number): string[] {
  return jobsDueAt(at(minute)).map((job) => job.name)
}

const ALWAYS = "inbound email sync"

describe("scheduled job table", () => {
  it("has valid, unique rows", () => {
    const names = new Set<string>()
    const paths = new Set<string>()
    for (const job of SCHEDULED_JOBS) {
      expect(60 % job.everyMinutes, `${job.name}: everyMinutes must divide 60`).toBe(0)
      expect(job.offsetMinute, `${job.name}: offset`).toBeGreaterThanOrEqual(0)
      expect(job.offsetMinute, `${job.name}: offset`).toBeLessThan(job.everyMinutes)
      expect(Number.isInteger(job.offsetMinute)).toBe(true)
      expect(job.why.trim().length, `${job.name}: explain why`).toBeGreaterThan(0)
      if (job.dailyAtUtcHour !== undefined) {
        expect(job.everyMinutes, `${job.name}: a daily job runs once an hour-of-day`).toBe(60)
        expect(Number.isInteger(job.dailyAtUtcHour) && job.dailyAtUtcHour >= 0 && job.dailyAtUtcHour < 24, `${job.name}: hour`).toBe(true)
        expect(job.heavy, `${job.name}: daily jobs must be light`).toBe(false)
      }
      names.add(job.name)
      paths.add(job.path)
    }
    expect(names.size).toBe(SCHEDULED_JOBS.length)
    expect(paths.size).toBe(SCHEDULED_JOBS.length)
  })

  it("runs every job the expected number of times an hour", () => {
    const counts = new Map<string, number>()
    for (let minute = 0; minute < 60; minute += 1) {
      for (const name of namesAt(minute)) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    for (const job of SCHEDULED_JOBS) {
      // at() is 15:xx UTC; a daily job runs only in its own hour.
      const expected = job.dailyAtUtcHour === undefined ? 60 / job.everyMinutes : job.dailyAtUtcHour === 15 ? 1 : 0
      expect(counts.get(job.name) ?? 0, job.name).toBe(expected)
    }
  })

  it("runs each daily job once a day, never in the same minute as another daily job", () => {
    const daily = SCHEDULED_JOBS.filter((job) => job.dailyAtUtcHour !== undefined)
    expect(daily.map((job) => job.name)).toContain("Data health check")
    for (const job of daily) {
      let runs = 0
      for (let hour = 0; hour < 24; hour += 1) {
        for (let minute = 0; minute < 60; minute += 1) {
          if (jobsDueAt(new Date(Date.UTC(2026, 10, 9, hour, minute))).includes(job)) runs += 1
        }
      }
      expect(runs, job.name).toBe(1)
    }
    const slots = daily.map((job) => `${job.dailyAtUtcHour}:${job.offsetMinute}`)
    expect(new Set(slots).size).toBe(slots.length)
  })

  it("keeps every minute to inbound email plus at most two jobs", () => {
    for (let minute = 0; minute < 60; minute += 1) {
      // Daily jobs are light and run once a day; they don't count here.
      const others = jobsDueAt(at(minute))
        .filter((job) => job.name !== ALWAYS && job.dailyAtUtcHour === undefined)
        .map((job) => job.name)
      expect(others.length, `minute :${minute} runs ${others.join(", ")}`).toBeLessThanOrEqual(2)
    }
  })

  it("never runs two heavy jobs in the same minute besides inbound email", () => {
    for (let minute = 0; minute < 60; minute += 1) {
      const heavy = jobsDueAt(at(minute)).filter((job) => job.heavy && job.name !== ALWAYS)
      expect(heavy.length, `minute :${minute} runs ${heavy.map((job) => job.name).join(", ")}`).toBeLessThanOrEqual(1)
    }
  })

  it("lists which jobs run in sample minutes", () => {
    expect(namesAt(0)).toEqual([ALWAYS, "project paper trail", "Notification digest"])
    expect(namesAt(1)).toEqual([ALWAYS, "My Compass calendars", "GoTo message recovery"])
    expect(namesAt(2)).toEqual([ALWAYS, "invitation email recovery", "Weather and fire"])
    expect(namesAt(5)).toEqual([ALWAYS, "project paper trail", "Sage bridge health"])
    expect(namesAt(10)).toEqual([ALWAYS, "project paper trail", "Square authentication health"])
    expect(namesAt(15)).toEqual([ALWAYS, "project paper trail", "Notification digest"])
    expect(namesAt(17)).toEqual([ALWAYS, "invitation email recovery", "Client meeting transcripts"])
    expect(namesAt(59)).toEqual([ALWAYS, "Sage Square manual receipts", "feedback reconciliation"])
  })

  it("looks up a job's cadence by name", () => {
    expect(scheduledEveryMinutes("project paper trail")).toBe(5)
    expect(() => scheduledEveryMinutes("no such job")).toThrow()
  })

  it("sweeps paper trail changes exactly once per 10-minute window", () => {
    const every = scheduledEveryMinutes("project paper trail")
    const sweeps = Array.from({ length: 60 }, (_, minute) => minute)
      .filter((minute) => namesAt(minute).includes("project paper trail"))
      .filter((minute) => minute % 10 < every)
    expect(sweeps.map((minute) => Math.floor(minute / 10))).toEqual([0, 1, 2, 3, 4, 5])
  })
})
