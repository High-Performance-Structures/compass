import { describe, expect, it } from "vitest"

import { isTaskAssignedToFieldUser } from "@/lib/field/task-assignment"

const dan = {
  email: "dan@hps-colorado.com",
  displayName: "Dan Vogel",
  firstName: "Dan",
  lastName: "Vogel",
}

describe("Field task assignment", () => {
  it("matches the signed-in user's display name, full name, or email", () => {
    expect(isTaskAssignedToFieldUser("Dan Vogel", dan)).toBe(true)
    expect(isTaskAssignedToFieldUser(" dan vogel ", dan)).toBe(true)
    expect(isTaskAssignedToFieldUser("dan@hps-colorado.com", dan)).toBe(true)
  })

  it("does not show another person's or an unassigned task", () => {
    expect(isTaskAssignedToFieldUser("Martine Vogel", dan)).toBe(false)
    expect(isTaskAssignedToFieldUser(null, dan)).toBe(false)
  })

  it("falls back to first and last name when display name is absent", () => {
    expect(
      isTaskAssignedToFieldUser("Dan Vogel", { ...dan, displayName: null })
    ).toBe(true)
  })
})
