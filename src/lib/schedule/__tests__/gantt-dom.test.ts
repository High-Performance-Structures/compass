// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { bindGanttTodayButton } from "../gantt-dom"

describe("Gantt DOM controls", () => {
  it("routes the built-in Today button through the synchronized view handler", () => {
    const root = document.createElement("div")
    const button = document.createElement("button")
    button.className = "today-button"
    root.appendChild(button)
    const onTodayClick = vi.fn()

    expect(bindGanttTodayButton(root, onTodayClick)).toBe(true)
    button.click()

    expect(onTodayClick).toHaveBeenCalledOnce()
  })

  it("leaves charts without a built-in Today button unchanged", () => {
    expect(bindGanttTodayButton(document.createElement("div"), vi.fn())).toBe(
      false
    )
  })
})
