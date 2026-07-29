import { describe, expect, it } from "vitest"

import {
  scheduleAssigneeTerms,
  scheduleViewDefinitionSchema,
} from "@/lib/schedule/saved-views"

describe("scheduleViewDefinitionSchema", () => {
  it("accepts a shareable schedule customization", () => {
    const result = scheduleViewDefinitionSchema.safeParse({
      view: "list",
      orderMode: "chronological",
      groupMode: "phase",
      preset: "next-30",
      status: ["PENDING", "IN_PROGRESS"],
      phase: ["Framing"],
      assignedTo: "Wes",
      search: "inspection",
      columns: ["phase", "startDate", "endDateCalculated", "assignedTo"],
    })

    expect(result.success).toBe(true)
  })

  it("rejects unsupported presets and columns", () => {
    const result = scheduleViewDefinitionSchema.safeParse({
      view: "list",
      orderMode: "chronological",
      groupMode: "none",
      preset: "next-365",
      status: [],
      phase: [],
      assignedTo: "",
      search: "",
      columns: ["privateNotes"],
    })

    expect(result.success).toBe(false)
  })
})

describe("scheduleAssigneeTerms", () => {
  it("builds the labels used by the My Items preset", () => {
    expect(
      scheduleAssigneeTerms({
        email: "wes@example.com",
        displayName: "Wes Jones",
        firstName: "Wes",
        lastName: "Jones",
      })
    ).toEqual(["Wes Jones", "wes@example.com"])
  })
})
