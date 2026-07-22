import { describe, expect, it } from "vitest"

import { buildSchedulePhaseOptions } from "@/lib/schedule/phase-options"

describe("schedule phase options", () => {
  it("includes imported project categories with their task counts", () => {
    const tasks = Array.from({ length: 28 }, () => ({
      phase: "Design & Preconstruction",
    }))

    const options = buildSchedulePhaseOptions(tasks)

    expect(options[0]).toEqual({
      value: "Design & Preconstruction",
      label: "Design & Preconstruction",
      taskCount: 28,
      projectPhase: true,
    })
  })

  it("deduplicates project categories without changing their saved spelling", () => {
    const options = buildSchedulePhaseOptions([
      { phase: "Interior Finishes" },
      { phase: " interior   finishes " },
    ])

    expect(options[0]).toMatchObject({
      value: "Interior Finishes",
      taskCount: 2,
      projectPhase: true,
    })
  })

  it("adds unused standard phases after categories already in the schedule", () => {
    const options = buildSchedulePhaseOptions([{ phase: "preconstruction" }])

    expect(options[0]).toMatchObject({
      value: "preconstruction",
      label: "Preconstruction",
      projectPhase: true,
    })
    expect(options.some((option) => option.value === "sitework")).toBe(true)
    expect(
      options.filter((option) => option.value === "preconstruction")
    ).toHaveLength(1)
  })
})
