import { describe, expect, it } from "vitest"
import { CUSTOM_BUILD_WORKFLOW, DESIGN_WORKFLOW, SCOPE_OF_WORK_WORKFLOW } from "@/lib/job-workflows/departments"
import { applyWorkflowOverrides, workflowProgress, type WorkflowCheck, type WorkflowDefinition } from "@/lib/job-workflows/engine"
import { jobWorkflowsSettingsSchema } from "@/lib/feature-settings/registry"
import { forwardJobStatusSuggestion, workflowCatchUp } from "@/lib/job-workflows/status"

const DEFINITION: WorkflowDefinition = {
  title: "test",
  steps: [
    {
      id: "one",
      label: "One",
      jobStatusId: "intake",
      items: [
        { id: "a", label: "Recorded", fact: "a", path: "information" },
        { id: "b", label: "Ticked", path: null },
      ],
    },
    {
      id: "two",
      label: "Two",
      jobStatusId: null,
      items: [
        { id: "c", label: "Recorded or ticked", fact: "c", tickable: true, path: null },
        { id: "d", label: "Only for pickup", fact: "d", path: null, when: "pickup" },
      ],
    },
    { id: "three", label: "Three", jobStatusId: null, items: [{ id: "e", label: "Only for delivery", path: null, when: "!pickup" }] },
  ],
}

const tick = (name: string | null = "Pat"): WorkflowCheck => ({ checkedAt: "2026-10-10T12:00:00.000Z", checkedByName: name })

describe("workflowProgress", () => {
  it("makes the first incomplete step current and names its first open item", () => {
    const progress = workflowProgress(DEFINITION, { a: true }, new Map())
    expect(progress.current?.id).toBe("one")
    expect(progress.nextAction).toBe("Ticked.")
    expect(progress.steps.map((step) => step.state)).toEqual(["current", "upcoming", "upcoming"])
  })

  it("completes items from records or ticks", () => {
    const progress = workflowProgress(DEFINITION, { a: true }, new Map([["one.b", tick()], ["two.c", tick()]]))
    expect(progress.steps[0]?.state).toBe("done")
    const c = progress.steps[1]?.items.find((item) => item.key === "two.c")
    expect(c).toMatchObject({ done: true, source: "tick", tickable: true })
    expect(progress.current?.id).toBe("three")
  })

  it("ignores a stored tick on an item only records can complete", () => {
    const progress = workflowProgress(DEFINITION, {}, new Map([["one.a", tick()]]))
    expect(progress.steps[0]?.items[0]).toMatchObject({ done: false, tickable: false, check: null })
  })

  it("shows conditional items only while their fact holds, and skips emptied steps", () => {
    const pickup = workflowProgress(DEFINITION, { pickup: true }, new Map())
    expect(pickup.steps.find((step) => step.id === "two")?.items.map((item) => item.label)).toContain("Only for pickup")
    expect(pickup.steps.some((step) => step.id === "three")).toBe(false)
    const delivery = workflowProgress(DEFINITION, {}, new Map())
    expect(delivery.steps.find((step) => step.id === "two")?.items.map((item) => item.label)).not.toContain("Only for pickup")
  })

  it("reports no current step once everything is done", () => {
    const progress = workflowProgress(DEFINITION, { a: true, c: true }, new Map([["one.b", tick()], ["three.e", tick()]]))
    expect(progress.current).toBeNull()
    expect(progress.nextAction).toBeNull()
  })
})

describe("applyWorkflowOverrides", () => {
  it("renames, hides and adds items and steps", () => {
    const changed = applyWorkflowOverrides(DEFINITION, {
      one: { label: "First", items: { a: { label: "Renamed" }, b: { hidden: true } }, extraItems: [{ id: "custom-x", label: "Ours" }] },
      two: { hidden: true },
      three: { jobStatusId: null },
    })
    expect(changed.steps.map((step) => step.label)).toEqual(["First", "Three"])
    expect(changed.steps[0]?.items.map((item) => item.label)).toEqual(["Renamed", "Ours"])
    expect(changed.steps[0]?.jobStatusId).toBe("intake")
    const progress = workflowProgress(changed, { a: true }, new Map())
    expect(progress.current?.items.find((item) => item.key === "one.custom-x")?.tickable).toBe(true)
  })

  it("keeps the built-in wording for blank labels", () => {
    const changed = applyWorkflowOverrides(DEFINITION, { one: { label: "  ", items: { a: { label: "" } } } })
    expect(changed.steps[0]?.label).toBe("One")
    expect(changed.steps[0]?.items[0]?.label).toBe("Recorded")
  })
})

describe("scope of work workflow", () => {
  it("starts at intake and moves to the estimate once intake is done", () => {
    const start = workflowProgress(SCOPE_OF_WORK_WORKFLOW, {}, new Map())
    expect(start.current?.id).toBe("intake")
    const next = workflowProgress(
      SCOPE_OF_WORK_WORKFLOW,
      { clientContact: true, hasAddress: true, linkedToOtherDepartment: true },
      new Map([["intake.plans", tick()]]),
    )
    expect(next.current?.id).toBe("estimate")
    expect(next.current?.jobStatusId).toBe("estimating")
  })

  it("has unique step and item ids", () => {
    const stepIds = SCOPE_OF_WORK_WORKFLOW.steps.map((step) => step.id)
    expect(new Set(stepIds).size).toBe(stepIds.length)
    for (const step of SCOPE_OF_WORK_WORKFLOW.steps) {
      const itemIds = step.items.map((item) => item.id)
      expect(new Set(itemIds).size).toBe(itemIds.length)
    }
  })
})

describe("job workflow settings", () => {
  it("accepts overrides and rejects malformed custom item ids", () => {
    expect(jobWorkflowsSettingsSchema.safeParse({ departments: { H: { intake: { extraItems: [{ id: "custom-site-visit-ab12cd", label: "Site visit" }] } } } }).success).toBe(true)
    expect(jobWorkflowsSettingsSchema.safeParse({ departments: { H: { intake: { extraItems: [{ id: "bad id", label: "x" }] } } } }).success).toBe(false)
  })
})

describe("forwardJobStatusSuggestion", () => {
  it("offers the current step's status only when the job's status belongs to an earlier step", () => {
    const atEstimate = workflowProgress(SCOPE_OF_WORK_WORKFLOW, { clientContact: true, hasAddress: true, linkedToOtherDepartment: true }, new Map([["intake.plans", tick()]]))
    expect(forwardJobStatusSuggestion(atEstimate, "intake")).toBe("estimating")
    expect(forwardJobStatusSuggestion(atEstimate, "estimating")).toBeNull()
    expect(forwardJobStatusSuggestion(atEstimate, "under_construction")).toBeNull()
    expect(forwardJobStatusSuggestion(atEstimate, "follow_up")).toBeNull()
    expect(forwardJobStatusSuggestion(atEstimate, "custom-status")).toBeNull()
  })
})

describe("workflowCatchUp", () => {
  it("offers to tick the open items before the step the job status has reached", () => {
    const progress = workflowProgress(CUSTOM_BUILD_WORKFLOW, { clientContact: true, hasAddress: true }, new Map())
    const catchUp = workflowCatchUp(progress, "under_construction")
    expect(catchUp?.stepLabel).toBe("Construction")
    expect(catchUp?.itemKeys).toContain("intake.meeting")
    expect(catchUp?.itemKeys).toContain("preconstruction.groundbreaking")
    expect(catchUp?.itemKeys.some((key) => key.startsWith("construction."))).toBe(false)
    // Items only records can complete are never ticked.
    expect(catchUp?.itemKeys).not.toContain("intake.client")
  })

  it("follows workflow order, not the status list", () => {
    const design = workflowProgress(DESIGN_WORKFLOW, {}, new Map())
    expect(workflowCatchUp(design, "in_design")?.stepLabel).toBe("Schematic design")
  })

  it("offers nothing when the checklist is at or ahead of the job status", () => {
    const progress = workflowProgress(CUSTOM_BUILD_WORKFLOW, {}, new Map())
    expect(workflowCatchUp(progress, "intake")).toBeNull()
    expect(workflowCatchUp(progress, "a-custom-status")).toBeNull()
  })

  it("defines unique ids in every built-in workflow", () => {
    for (const definition of [CUSTOM_BUILD_WORKFLOW, DESIGN_WORKFLOW]) {
      const stepIds = definition.steps.map((step) => step.id)
      expect(new Set(stepIds).size).toBe(stepIds.length)
      for (const step of definition.steps) {
        const itemIds = step.items.map((item) => item.id)
        expect(new Set(itemIds).size).toBe(itemIds.length)
      }
    }
  })
})
