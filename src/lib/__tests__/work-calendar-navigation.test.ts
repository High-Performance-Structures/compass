import { describe, expect, it } from "vitest"
import { workCalendarFilter, workCalendarFilterHref } from "../work-calendar-navigation"

describe("Work Calendar entry and filter navigation", () => {
  it("opens to events when no specific view was requested", () => {
    expect(workCalendarFilter(undefined)).toBe("event")
    expect(workCalendarFilter("unknown")).toBe("event")
  })
  it.each(["all", "schedule", "event", "task", "rfi", "purchase_order"])("preserves explicit %s links", (value) => {
    expect(workCalendarFilter(value)).toBe(value)
    expect(workCalendarFilter([value])).toBe(value)
  })
  it("does not hide a source record in an older link without a kind", () => {
    expect(workCalendarFilter(undefined, "task-id")).toBe("all")
    expect(workCalendarFilter("task", "task-id")).toBe("task")
  })
  it("retains explicit All, date, view and people while removing the old focus", () => {
    const url = new URL(workCalendarFilterHref(new URLSearchParams("kind=event&date=2026-10-31&view=month&people=all&item=old"), "all"), "https://example.test")
    expect(url.searchParams.get("kind")).toBe("all")
    expect(url.searchParams.get("date")).toBe("2026-10-31")
    expect(url.searchParams.get("view")).toBe("month")
    expect(url.searchParams.get("people")).toBe("all")
    expect(url.searchParams.has("item")).toBe(false)
  })
})
