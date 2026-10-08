import { describe, expect, it } from "vitest"
import {
  isMappedDepartment,
  phaseForJobStatus,
  portfolioHealth,
  resolveTown,
  spreadSharedTowns,
  type PortfolioMapJob,
} from "../model"

function job(overrides: Partial<PortfolioMapJob> & Pick<PortfolioMapJob, "id">): PortfolioMapJob {
  return {
    name: "Sample",
    projectNumber: null,
    phase: "construction",
    statusLabel: "Under Construction",
    town: "Granby",
    lon: -105.94,
    lat: 40.09,
    progress: 40,
    pastDueCount: 0,
    stalledCount: 0,
    nextTaskTitle: null,
    nextTaskStart: null,
    health: "ok",
    ...overrides,
  }
}

describe("phaseForJobStatus", () => {
  it("maps standard job statuses to pipeline phases", () => {
    expect(phaseForJobStatus("budget_estimating", "Budget Estimating")).toBe("estimating")
    expect(phaseForJobStatus("in_design", "In Design")).toBe("design")
    expect(phaseForJobStatus("permitting", "Permitting")).toBe("permitting")
    expect(phaseForJobStatus("awaiting_groundbreaking", "Awaiting Groundbreaking")).toBe("precon")
    expect(phaseForJobStatus("under_construction", "Under Construction")).toBe("construction")
    expect(phaseForJobStatus("punchlist", "Punchlist")).toBe("closeout")
  })

  it("leaves finished, refused and inactive jobs off the map", () => {
    for (const id of ["under_warranty", "complete", "closed", "bid_refused", "inactive"]) {
      expect(phaseForJobStatus(id, null)).toBeNull()
    }
  })

  it("leaves material order statuses off the map", () => {
    for (const id of ["ordered", "partial_order", "price_sheet_sent", "shipping_tbd", "awaiting_payment"]) {
      expect(phaseForJobStatus(id, null)).toBeNull()
    }
  })

  it("matches custom statuses by their label", () => {
    expect(phaseForJobStatus("custom-123", "under construction")).toBe("construction")
    expect(phaseForJobStatus("custom-456", "Office remodel")).toBeNull()
  })
})

describe("isMappedDepartment", () => {
  it("keeps HPS and Open Range construction and design jobs and leaves Nu-Tech off", () => {
    expect(isMappedDepartment({ department: null, projectId: "p1", projectNumber: "H-430-1900" })).toBe(true)
    expect(isMappedDepartment({ department: null, projectId: "p2", projectNumber: "O-202-595" })).toBe(true)
    expect(isMappedDepartment({ department: null, projectId: "p3", projectNumber: "D-18-00" })).toBe(true)
    expect(isMappedDepartment({ department: null, projectId: "p4", projectNumber: "N-830-8220" })).toBe(false)
    expect(isMappedDepartment({ department: "N", projectId: "p5", projectNumber: "H-1" })).toBe(false)
    expect(isMappedDepartment({ department: null, projectId: "p6", projectNumber: null })).toBe(true)
  })
})

describe("resolveTown", () => {
  it("prefers the public city field", () => {
    expect(resolveTown({ publicLocationCity: "Estes Park", address: "1 Main St, Lyons, CO", name: "X" })?.town).toBe("Estes Park")
  })

  it("finds the town inside a full address", () => {
    const town = resolveTown({ publicLocationCity: null, address: "123 County Rd 41, Granby, CO 80446", name: "X" })
    expect(town?.town).toBe("Granby")
    expect(town?.lat).toBeGreaterThan(39.9)
    expect(town?.lat).toBeLessThan(40.3)
  })

  it("falls back to the town at the end of the project name", () => {
    expect(resolveTown({ publicLocationCity: null, address: null, name: "O-170-2684 County Ln 7 - Salida" })?.town).toBe("Salida")
  })

  it("returns null rather than guessing", () => {
    expect(resolveTown({ publicLocationCity: null, address: "PO Box 12", name: "Warehouse" })).toBeNull()
  })
})

describe("portfolioHealth", () => {
  it("ranks past due above stalled", () => {
    expect(portfolioHealth(2, 1)).toBe("late")
    expect(portfolioHealth(0, 1)).toBe("risk")
    expect(portfolioHealth(0, 0)).toBe("ok")
  })
})

describe("spreadSharedTowns", () => {
  it("fans out jobs that share a town and leaves single jobs in place", () => {
    const spread = spreadSharedTowns([
      job({ id: "a" }),
      job({ id: "b" }),
      job({ id: "c", town: "Salida", lon: -105.99, lat: 38.53 }),
    ])
    const [a, b, c] = spread
    expect(a?.lon).not.toBe(b?.lon)
    expect(Math.abs((a?.lon ?? 0) - -105.94)).toBeLessThan(0.05)
    expect(c?.lon).toBe(-105.99)
  })
})
