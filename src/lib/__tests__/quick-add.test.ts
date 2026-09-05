import { describe, expect, it } from "vitest"

import {
  QUICK_ADD_ACTIONS,
  quickAddHref,
} from "@/lib/quick-add"

describe("Quick Add routes", () => {
  it("defines the bounded action set", () => {
    expect(QUICK_ADD_ACTIONS).toEqual([
      "message",
      "daily-log",
      "todo",
      "schedule-item",
      "rfi",
    ])
  })

  it("routes staff to existing dashboard workflows", () => {
    expect(quickAddHref("message", "project one", "staff")).toBe(
      "/dashboard/projects/project%20one/messages?quickAdd=message",
    )
    expect(quickAddHref("daily-log", "project one", "staff")).toBe(
      "/dashboard/projects/project%20one/daily-logs?quickAdd=daily-log",
    )
    expect(quickAddHref("todo", "project one", "staff")).toBe(
      "/dashboard/projects/project%20one/todos?quickAdd=todo",
    )
    expect(quickAddHref("schedule-item", "project one", "staff")).toBe(
      "/dashboard/projects/project%20one/schedule?quickAdd=schedule-item",
    )
    expect(quickAddHref("rfi", "project one", "staff")).toBe(
      "/dashboard/projects/project%20one/rfis?quickAdd=rfi",
    )
  })

  it("routes external actions through their guarded preview workspace", () => {
    expect(quickAddHref("message", "project/one", "owner")).toBe(
      "/preview/projects/project%2Fone/owner/conversations?quickAdd=message",
    )
    expect(quickAddHref("message", "project/one", "sub_vendor")).toBe(
      "/preview/projects/project%2Fone/sub-vendor/conversations?quickAdd=message",
    )
    expect(quickAddHref("rfi", "project/one", "sub_vendor")).toBe(
      "/preview/projects/project%2Fone/sub-vendor/rfis?quickAdd=rfi",
    )
  })
})
