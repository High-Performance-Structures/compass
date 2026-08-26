import { expect, test } from "vitest"

import {
  getProjectTargetSection,
  getSidebarContextMode,
} from "@/lib/sidebar-navigation"

test("keeps the current project section when switching projects", () => {
  expect(
    getProjectTargetSection(
      "/dashboard/projects/project-123/estimate/compare",
    ),
  ).toBe("estimate")
  expect(
    getProjectTargetSection(
      "/dashboard/projects/project-123/preview/owner",
    ),
  ).toBe("preview/owner")
  expect(getProjectTargetSection("/dashboard/projects/project-123")).toBe(
    undefined,
  )
})

test("keeps the main grouped menu when a project is selected", () => {
  expect(
    getSidebarContextMode(
      "/dashboard/projects/project-123/estimate",
      true,
    ),
  ).toBe("main")
})

test("keeps supported contextual menus for expanded file and conversation views", () => {
  expect(getSidebarContextMode("/dashboard/files", true)).toBe("files")
  expect(
    getSidebarContextMode("/dashboard/conversations/channel-123", true),
  ).toBe("conversations")
})

test("uses the main menu when the sidebar is collapsed", () => {
  expect(getSidebarContextMode("/dashboard/files", false)).toBe("main")
})
