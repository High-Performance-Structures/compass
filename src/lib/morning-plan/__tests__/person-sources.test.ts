import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { personPlan, personSources, type OrgPlanRows, type PlanPerson } from "@/lib/morning-plan/server"

const wes: PlanPerson = {
  id: "user-wes",
  email: "wes@example.com",
  googleEmail: null,
  displayName: "Wes Jones",
  firstName: "Wes",
  lastName: "Jones",
  otherNames: ["Wesley Jones"],
}

const rows: OrgPlanRows = {
  today: "2026-10-28",
  tasks: [
    { id: "t1", title: "Framing", projectLabel: "O-202", startDate: "2026-10-26", endDate: "2026-10-30", href: "/t1", assignedTo: "Daniel Vogel, Wesley Jones", assignedUserId: null },
    { id: "t2", title: "Roofing", projectLabel: "O-202", startDate: "2026-10-26", endDate: "2026-10-30", href: "/t2", assignedTo: null, assignedUserId: "user-wes" },
    { id: "t3", title: "Drywall", projectLabel: "O-170", startDate: "2026-10-26", endDate: "2026-10-30", href: "/t3", assignedTo: "GP Framing", assignedUserId: null },
  ],
  todos: [
    { id: "d1", title: "Call inspector", projectLabel: "O-202", dueDate: "2026-10-28", priority: "normal", href: "/d1", assigneeName: "Wes Jones" },
    { id: "d2", title: "Order trim", projectLabel: "O-202", dueDate: "2026-10-28", priority: "normal", href: "/d2", assigneeName: "Rebekah Jones" },
  ],
  meetings: [
    { id: "event:e1", title: "Office meeting", projectLabel: null, startTime: "08:30", href: "/e1", userIds: new Set(["user-wes"]), emails: new Set() },
    { id: "meeting:m1", title: "Client walk", projectLabel: "O-202", startTime: "13:00", href: "/m1", userIds: new Set(["someone"]), emails: new Set(["wes@example.com"]) },
    { id: "event:e2", title: "Not invited", projectLabel: null, startTime: "10:00", href: "/e2", userIds: new Set(["someone"]), emails: new Set() },
  ],
  exceptions: [],
}

describe("personSources", () => {
  it("matches assignments by user, any listed name, and meeting invites", () => {
    const sources = personSources(rows, wes)
    expect(sources.scheduleItems.map((item) => item.id)).toEqual(["t1", "t2"])
    expect(sources.todos.map((item) => item.id)).toEqual(["d1"])
    expect(sources.meetings.map((item) => item.id)).toEqual(["event:e1", "meeting:m1"])
  })
})

describe("personPlan", () => {
  it("builds the plan and flags a double-booked week", () => {
    const settings = { enabled: true, overloadWarnings: true, overloadThresholdPercent: 100, todoWorkdays: 0.25, allowDailyDigest: true }
    const { plan, load } = personPlan(rows, wes, settings)
    expect(plan.entries.map((entry) => entry.key)).toEqual([
      "todo:d1",
      "schedule:t1",
      "schedule:t2",
      "meeting:event:e1",
      "meeting:meeting:m1",
    ])
    expect(load).toMatchObject({ availableWorkdays: 5, assignedWorkdays: 10.25, overloaded: true })
    expect(personPlan(rows, wes, { ...settings, overloadWarnings: false }).load).toBeNull()
  })
})
