import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/actions/project-timeline", () => ({ getProjectTimeline: vi.fn() }))

import { ProjectTimelinePanel } from "@/components/projects/project-timeline"
import { PROJECT_TIMELINE_KINDS, type ProjectTimeline } from "@/lib/project-timeline/model"

const timeline: ProjectTimeline = {
  from: "2026-10-01",
  to: "2026-10-14",
  kinds: PROJECT_TIMELINE_KINDS,
  days: [
    {
      date: "2026-10-14",
      items: [
        { id: "log-1", kind: "log", date: "2026-10-14", at: "2026-10-14T20:00:00Z", title: "Daily log by Dan", body: "Set joists", meta: "06 11 00 Wood Framing 20 h", href: "/dashboard/projects/p1/daily-logs#daily-log-1", hrefLabel: "Open log", ownerVisible: true, blocked: false },
        { id: "todo-1", kind: "todo", date: "2026-10-14", at: "2026-10-14T20:00:00Z", title: "Still blocked: Framing inspection", body: null, meta: null, href: null, hrefLabel: null, ownerVisible: false, blocked: true },
      ],
    },
  ],
  codeHours: [{ code: "06 11 00", label: "Wood Framing", hours: 20 }],
  todoHours: 20,
  otherHours: 0,
}

describe("project timeline panel", () => {
  it("shows the day's items, filters with counts and hours by cost code", () => {
    const html = renderToStaticMarkup(createElement(ProjectTimelinePanel, { projectId: "p1", initial: timeline }))
    expect(html).toContain("What&#x27;s happening")
    expect(html).toContain("Daily log by Dan")
    expect(html).toContain("Shared with the owner")
    expect(html).toContain('aria-label="Blocked"')
    expect(html).toMatch(/All<span[^>]*>2<\/span>/)
    expect(html).toContain("On to-dos 20 h · not on a to-do 0 h")
    expect(html).toContain("Show the 14 days before")
  })

  it("has a deliberate empty state", () => {
    const html = renderToStaticMarkup(createElement(ProjectTimelinePanel, { projectId: "p1", initial: { ...timeline, days: [], codeHours: [] } }))
    expect(html).toContain("Nothing logged on this job since")
    expect(html).toContain("Write a daily log")
  })
})
