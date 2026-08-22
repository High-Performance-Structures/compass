import { expect, test } from "vitest"

import { getSidebarContextMode } from "@/lib/sidebar-navigation"

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
