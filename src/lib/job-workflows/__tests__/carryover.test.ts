import { describe, expect, it } from "vitest"

import { carriedTicks, carryoverFor, DEFAULT_WORKFLOW_CARRYOVERS } from "@/lib/job-workflows/carryover-defaults"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import { workflowItemKey } from "@/lib/job-workflows/engine"
import type { ProjectDepartment } from "@/lib/project-branding"

function itemKeys(department: ProjectDepartment, tickableOnly: boolean): ReadonlySet<string> {
  const definition = DEPARTMENT_WORKFLOWS[department]
  return new Set(
    (definition?.steps ?? []).flatMap((step) =>
      step.items
        .filter((item) => !tickableOnly || item.fact === undefined || item.tickable === true)
        .map((item) => workflowItemKey(step.id, item.id))
    )
  )
}

describe("default workflow carryovers", () => {
  it("map real items onto items someone can tick", () => {
    for (const carryover of DEFAULT_WORKFLOW_CARRYOVERS) {
      const sources = itemKeys(carryover.from, false)
      const targets = itemKeys(carryover.to, true)
      for (const [from, to] of Object.entries(carryover.items)) {
        expect(sources.has(from), `${carryover.from} ${from}`).toBe(true)
        expect(targets.has(to), `${carryover.to} ${to}`).toBe(true)
      }
    }
  })

  it("uses the company's version of a pair, then the default, then none", () => {
    const saved = [{ from: "D" as const, to: "O" as const, items: { "intake.meeting": "" } }]
    expect(carryoverFor(saved, "D", "O")?.items).toEqual({ "intake.meeting": "" })
    expect(carryoverFor(undefined, "D", "O")?.items["agreement.signed"]).toBe("design_agreement.signed")
    expect(carryoverFor(undefined, "O", "D")).toBeNull()
  })
})

describe("carriedTicks", () => {
  it("carries mapped, tickable, unticked items once", () => {
    const ticks = carriedTicks({
      items: { a: "x", b: "y", c: "x", d: "z", e: "" },
      sourceChecks: [
        { itemKey: "a", checkedBy: "pat", checkedAt: "1" },
        { itemKey: "b", checkedBy: "pat", checkedAt: "2" },
        { itemKey: "c", checkedBy: "sam", checkedAt: "3" },
        { itemKey: "d", checkedBy: "sam", checkedAt: "4" },
        { itemKey: "e", checkedBy: "sam", checkedAt: "5" },
      ],
      targetTickableKeys: new Set(["x", "y"]),
      targetCheckedKeys: new Set(["y"]),
    })
    expect(ticks).toEqual([{ sourceKey: "a", targetKey: "x", checkedBy: "pat", checkedAt: "1" }])
  })
})
