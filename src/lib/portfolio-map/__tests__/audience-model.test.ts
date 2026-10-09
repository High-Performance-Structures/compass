import { describe, expect, it } from "vitest"
import { audienceMapJobs, ownerPhaseSteps, ownerScheduleProgress, vendorJobScope, type AudienceJobRow } from "@/lib/portfolio-map/audience-model"

function row(overrides: Partial<AudienceJobRow> = {}): AudienceJobRow {
  return {
    id: "p1",
    name: "H-430-1900 Ezell Residence",
    projectNumber: "H-430-1900",
    address: "123 Main St, Granby, CO 80446",
    publicLocationCity: null,
    jobStatusId: "current",
    statusLabel: "Current",
    ...overrides,
  }
}

describe("audienceMapJobs", () => {
  it("places assigned jobs by town without office-only signals", () => {
    const [job] = audienceMapJobs([row()])
    expect(job?.town).toBe("Granby")
    expect(job?.lat).not.toBeNull()
    expect(job?.progress).toBeNull()
    expect(job?.health).toBe("ok")
    expect(job?.pastDueCount).toBe(0)
    expect(job?.nextTaskTitle).toBeNull()
  })

  it("leaves out complete and internal jobs", () => {
    expect(audienceMapJobs([row({ jobStatusId: "complete", statusLabel: "Complete" })])).toEqual([])
    expect(audienceMapJobs([row({ jobStatusId: "internal", statusLabel: "Internal" })])).toEqual([])
  })

  it("keeps a job with no known town so it can be listed", () => {
    const [job] = audienceMapJobs([row({ address: null, name: "Mystery job" })])
    expect(job?.town).toBeNull()
  })
})

describe("vendorJobScope", () => {
  const item = (id: string, startDate: string, endDate: string, percentComplete = 0) => ({
    id, title: `Item ${id}`, startDate, endDate, percentComplete,
  })

  it("lists the next three unfinished items and counts commitments", () => {
    const scope = vendorJobScope({
      scheduleItems: [
        item("done", "2026-10-01", "2026-10-20", 100),
        item("past", "2026-09-01", "2026-09-05"),
        item("c", "2026-10-15", "2026-10-16"),
        item("a", "2026-10-07", "2026-10-09"),
        item("b", "2026-10-10", "2026-10-12"),
        item("d", "2026-11-01", "2026-11-02"),
      ],
      operations: [{}, {}],
    }, "2026-10-08")
    expect(scope.upcoming.map((entry) => entry.id)).toEqual(["a", "b", "c"])
    expect(scope.commitmentCount).toBe(2)
  })
})

describe("owner relief helpers", () => {
  it("weights progress by workdays", () => {
    expect(ownerScheduleProgress([
      { percentComplete: 100, workdays: 1 },
      { percentComplete: 0, workdays: 3 },
    ])).toBe(25)
    expect(ownerScheduleProgress([])).toBeNull()
  })

  it("marks earlier phases done and later ones upcoming", () => {
    const steps = ownerPhaseSteps("permitting")
    expect(steps.map((step) => step.label)).toEqual(["Design", "Pricing", "Contract", "Permits", "Under construction", "Finishing up"])
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"])
    expect(steps[5]?.label).toBe("Finishing up")
  })
})
