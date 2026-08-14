import { expect, test } from "vitest"
import { shouldOpenConversationPanel } from "@/components/nav-main"

test("uses the side drawer only for the Conversations link when the panel is available", () => {
  expect(shouldOpenConversationPanel("Conversations", true)).toBe(true)
  expect(shouldOpenConversationPanel("Projects", true)).toBe(false)
  expect(shouldOpenConversationPanel("Conversations", false)).toBe(false)
})
