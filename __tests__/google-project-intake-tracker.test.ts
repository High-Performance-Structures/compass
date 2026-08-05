import { describe, expect, it } from "vitest"

import {
  allocateProjectNumber,
  buildProjectTrackerRow,
  locateProjectTrackerLayout,
  type ProjectIntakeTrackerInput,
} from "@/lib/google/project-intake-tracker"

const PROJECT: ProjectIntakeTrackerInput = {
  department: "O",
  projectName: "Mitchell Residence",
  clientName: "Dan and Jane Mitchell",
  companyName: null,
  clientFirstName: "Dan",
  clientLastName: "Mitchell",
  contactPhone: "970-555-0100",
  contactEmail: "dan@example.com",
  streetNumber: "33 A",
  streetName: "Mitchell Lane",
  cityStateZip: "Durango, CO 81301",
  billingAddress: "PO Box 22",
  assignedTo: "Wes Jones",
  referredBy: "Existing client",
  notes: "Call before site visit",
  intakeDate: "2026-08-05",
}

describe("Google Project Lead Tracking intake", () => {
  it("locates a shifted tracker header and allocates the next department number", () => {
    const rows = [
      ["Project Lead Tracking"],
      [],
      ["PROJECT NUMBER", "Type", "ACTIVE PROJECTS"],
      ["O-208-14", "O", "Prior project"],
      ["H-994-82", "H", "HPS project"],
      ["O-210-17", "O", "Latest ORC project"],
    ]
    const layout = locateProjectTrackerLayout(rows)

    expect(layout).not.toBeNull()
    if (!layout) return
    expect(layout.headerRowNumber).toBe(3)
    expect(
      allocateProjectNumber({
        department: "O",
        streetNumber: PROJECT.streetNumber,
        rows,
        layout,
      })
    ).toBe("O-211-33A")
  })

  it("maps values by header name so tracker column moves remain safe", () => {
    const layout = locateProjectTrackerLayout([
      [
        "Notes",
        "CLIENT FIRST NAME",
        "ACTIVE PROJECTS",
        "PROJECT NUMBER",
        "CONTACT EMAIL",
        "ASSIGNED TO",
        "INTAKE DATE",
      ],
    ])
    expect(layout).not.toBeNull()
    if (!layout) return

    expect(
      buildProjectTrackerRow({
        layout,
        project: PROJECT,
        projectNumber: "O-211-33A",
      })
    ).toEqual([
      "Call before site visit",
      "Dan",
      "Mitchell Residence",
      "O-211-33A",
      "dan@example.com",
      "Wes Jones",
      "2026-08-05",
    ])
  })

  it("uses a safe street placeholder when a lead has no street number yet", () => {
    const rows = [["PROJECT NUMBER"], ["D-27-45"]]
    const layout = locateProjectTrackerLayout(rows)
    expect(layout).not.toBeNull()
    if (!layout) return

    expect(
      allocateProjectNumber({
        department: "D",
        streetNumber: null,
        rows,
        layout,
      })
    ).toBe("D-28-00")
  })

  it("advances past a Compass reservation that is not in Google yet", () => {
    const rows = [["PROJECT NUMBER"], ["O-210-17"]]
    const layout = locateProjectTrackerLayout(rows)
    expect(layout).not.toBeNull()
    if (!layout) return

    expect(
      allocateProjectNumber({
        department: "O",
        streetNumber: "55",
        rows,
        layout,
        reservedProjectNumbers: ["O-211-33", "H-995-20"],
      })
    ).toBe("O-212-55")
  })
})
