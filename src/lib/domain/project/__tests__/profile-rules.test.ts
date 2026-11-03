import { describe, expect, it } from "vitest"

import {
  canRetrySyncOperation,
  projectAddressParts,
  projectClientStatus,
  syncProjectNumbers,
  trackerDepartment,
} from "@/lib/domain/project/profile-rules"

describe("project profile rules", () => {
  it("reads the client status, defaulting to customer", () => {
    expect(projectClientStatus("lead")).toBe("lead")
    expect(projectClientStatus("customer")).toBe("customer")
    expect(projectClientStatus("prospect")).toBe("customer")
  })

  it("maps a project number prefix to its tracker department", () => {
    expect(trackerDepartment("O-58-3674")).toBe("O")
    expect(trackerDepartment(" h-1-2")).toBe("H")
    expect(trackerDepartment("N-1")).toBe("N")
    expect(trackerDepartment("D-1")).toBe("D")
    expect(trackerDepartment("X-1")).toBeNull()
    expect(trackerDepartment(null)).toBeNull()
  })

  it("splits an address into street number, street name and the rest", () => {
    expect(projectAddressParts("123 Main St, Woodland Park, CO 80863")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
      cityStateZip: "Woodland Park, CO 80863",
    })
    expect(projectAddressParts("Ranch Road")).toEqual({ streetNumber: "Ranch", streetName: "Road", cityStateZip: null })
    expect(projectAddressParts("Ranch")).toEqual({ streetNumber: null, streetName: "Ranch", cityStateZip: null })
    expect(projectAddressParts(null)).toEqual({ streetNumber: null, streetName: null, cityStateZip: null })
  })

  it("reads the project numbers a sync operation carries", () => {
    expect(syncProjectNumbers(JSON.stringify({ previousProjectNumber: "O-1-A", projectNumber: "O-1-B" }))).toEqual({
      previousProjectNumber: "O-1-A",
      projectNumber: "O-1-B",
    })
    expect(syncProjectNumbers(JSON.stringify({ projectNumber: "O-1-B" }))).toBeNull()
    expect(syncProjectNumbers(JSON.stringify({ previousProjectNumber: 1, projectNumber: "O-1-B" }))).toBeNull()
    expect(syncProjectNumbers("not json")).toBeNull()
    expect(syncProjectNumbers("null")).toBeNull()
  })

  it("offers retry for every sync operation that has not completed", () => {
    expect(canRetrySyncOperation("pending")).toBe(true)
    expect(canRetrySyncOperation("failed")).toBe(true)
    expect(canRetrySyncOperation("completed")).toBe(false)
  })
})
