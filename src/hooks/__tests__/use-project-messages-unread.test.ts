import { describe, expect, it } from "vitest"

import type { NavItem } from "@/components/nav-main"
import { withMessagesUnread } from "@/hooks/use-project-messages-unread"

const nav: ReadonlyArray<NavItem> = [
  { kind: "link", title: "Dashboard", url: "/dashboard" },
  {
    kind: "group",
    title: "Projects",
    icon: (() => null) as never,
    items: [
      { kind: "link", title: "Overview", url: "/dashboard/projects/p1" },
      { kind: "link", title: "Messages", url: "/dashboard/projects/p1/messages" },
    ],
  },
]

describe("withMessagesUnread", () => {
  it("puts a plain unread count on the job's Messages link only", () => {
    const [, projects] = withMessagesUnread(nav, 3)
    const items = projects?.kind === "group" ? projects.items : []
    expect(items[0]).not.toHaveProperty("alert")
    expect(items[1]).toMatchObject({ alert: { count: 3, label: "3 unread", tone: "unread" } })
  })

  it("leaves the menu untouched when nothing is unread", () => {
    expect(withMessagesUnread(nav, 0)).toBe(nav)
  })
})
