import { describe, expect, it } from "vitest"
import {
  wouldCreateCycle,
  wouldDependencyUpdateCreateCycle,
} from "../dependency-validation"
import type { TaskDependencyData } from "../types"

function dependency(
  id: string,
  predecessorId: string,
  successorId: string
): TaskDependencyData {
  return {
    id,
    predecessorId,
    successorId,
    type: "FS",
    lagDays: 0,
  }
}

describe("schedule dependency validation", () => {
  const dependencies = [
    dependency("a-b", "a", "b"),
    dependency("b-c", "b", "c"),
  ]

  it("rejects a dependency that closes a cycle", () => {
    expect(wouldCreateCycle(dependencies, "c", "a")).toBe(true)
  })

  it("validates an edited dependency without counting its old edge", () => {
    expect(
      wouldDependencyUpdateCreateCycle(dependencies, "a-b", "a", "c")
    ).toBe(false)
  })

  it("still rejects a cycle introduced by an edited dependency", () => {
    expect(
      wouldDependencyUpdateCreateCycle(dependencies, "a-b", "c", "b")
    ).toBe(true)
  })
})
