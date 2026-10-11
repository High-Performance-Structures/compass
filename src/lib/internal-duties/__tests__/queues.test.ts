import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { dutiesFor } from "@/lib/internal-duties/model"
import { INTERNAL_QUEUE_ORDER, INTERNAL_QUEUES, orderedQueues, queueHref } from "@/lib/internal-duties/queues"

describe("internal work queues", () => {
  it("leads the office with what's behind and the owner's office with business development", () => {
    expect(INTERNAL_QUEUE_ORDER.office[0]).toBe("recurring-duties")
    expect(INTERNAL_QUEUE_ORDER.executive.slice(0, 3)).toEqual(["business-development", "new-leads", "managerial-accounting"])
  })

  it("ties each queue with a cost code to a duty the workspace can log", () => {
    const office = new Set(dutiesFor(FEATURE_SETTINGS["internal-duties"].defaults, "office").map((duty) => duty.code))
    for (const kind of ["office", "executive"] as const) {
      for (const id of INTERNAL_QUEUE_ORDER[kind]) {
        const code = INTERNAL_QUEUES[id].sageCode
        if (code) expect(office.has(code)).toBe(true)
      }
    }
  })

  it("applies a saved order and keeps queues added later", () => {
    const ids = orderedQueues("office", ["billing", "unknown", "accounts-payable"]).map((queue) => queue.id)
    expect(ids.slice(0, 2)).toEqual(["billing", "accounts-payable"])
    expect(ids).toHaveLength(INTERNAL_QUEUE_ORDER.office.length)
  })

  it("links workspace queues to the workspace", () => {
    expect(queueHref(INTERNAL_QUEUES["duty-log"], "proj-h-office")).toBe("/dashboard/projects/proj-h-office/duty-log")
  })
})
