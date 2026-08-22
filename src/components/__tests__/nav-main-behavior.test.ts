import { expect, test } from "vitest"
import {
  getActiveNavItemUrl,
  shouldOpenConversationPanel,
  type NavLinkItem,
} from "@/components/nav-main"

test("uses the side drawer only for the Conversations link when the panel is available", () => {
  expect(shouldOpenConversationPanel("Conversations", true)).toBe(true)
  expect(shouldOpenConversationPanel("Projects", true)).toBe(false)
  expect(shouldOpenConversationPanel("Conversations", false)).toBe(false)
})

test("selects the most specific submenu item for nested routes", () => {
  const items: ReadonlyArray<NavLinkItem> = [
    {
      kind: "link",
      title: "All Projects",
      url: "/dashboard/projects",
    },
    {
      kind: "link",
      title: "Change Orders",
      url: "/dashboard/projects/select?target=change-orders",
    },
  ]

  expect(
    getActiveNavItemUrl(
      items,
      "/dashboard/projects/select",
      new URLSearchParams("target=change-orders"),
    ),
  ).toBe("/dashboard/projects/select?target=change-orders")
})

test("distinguishes planning submenu items that share a pathname", () => {
  const items: ReadonlyArray<NavLinkItem> = [
    {
      kind: "link",
      title: "To-Dos",
      url: "/dashboard/schedule?kind=task",
    },
    {
      kind: "link",
      title: "Work Calendar",
      url: "/dashboard/schedule",
    },
    {
      kind: "link",
      title: "Project Schedule",
      url: "/dashboard/schedule?mode=projects&scope=all&view=gantt",
    },
  ]

  expect(
    getActiveNavItemUrl(
      items,
      "/dashboard/schedule",
      new URLSearchParams("kind=task"),
    ),
  ).toBe("/dashboard/schedule?kind=task")
  expect(
    getActiveNavItemUrl(
      items,
      "/dashboard/schedule",
      new URLSearchParams("mode=projects&scope=all&view=gantt"),
    ),
  ).toBe("/dashboard/schedule?mode=projects&scope=all&view=gantt")
  expect(
    getActiveNavItemUrl(
      items,
      "/dashboard/schedule",
      new URLSearchParams("view=week"),
    ),
  ).toBe("/dashboard/schedule")
})

test("does not treat the dashboard root as active on every dashboard page", () => {
  const dashboard: NavLinkItem = {
    kind: "link",
    title: "Dashboard",
    url: "/dashboard",
  }

  expect(
    getActiveNavItemUrl(
      [dashboard],
      "/dashboard/projects",
      new URLSearchParams(),
    ),
  ).toBeNull()
})
