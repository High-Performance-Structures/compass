import { describe, expect, it } from "vitest"
import { persistGanttScrollPosition } from "../gantt-scroll"

describe("Gantt scroll storage", () => {
  it("persists through a deferred sessionStorage getter", () => {
    const values = new Map<string, string>()
    const availableWindow = {
      get sessionStorage(): { setItem: (key: string, value: string) => void } {
        return {
          setItem(key: string, value: string): void {
            values.set(key, value)
          },
        }
      },
    }

    persistGanttScrollPosition(
      () => availableWindow.sessionStorage,
      "compass:schedule-scroll:project-1",
      { left: 640, top: 192 }
    )

    expect(values.get("compass:schedule-scroll:project-1")).toBe(
      JSON.stringify({ left: 640, top: 192 })
    )
  })

  it("swallows a throwing sessionStorage getter", () => {
    const blockedWindow = {
      get sessionStorage(): never {
        throw new Error("sessionStorage is unavailable")
      },
    }

    expect(() =>
      persistGanttScrollPosition(
        () => blockedWindow.sessionStorage,
        "compass:schedule-scroll:project-1",
        { left: 640, top: 192 }
      )
    ).not.toThrow()
  })
})
