import { describe, expect, it } from "vitest"

import {
  allocateProjectNumber,
  buildDepartmentTrackerRow,
  buildProjectRegistryRow,
  departmentTrackingDestination,
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

describe("Google Developer-folder project tracking intake", () => {
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

  it("allocates from the Developer Project Registry Project ID column", () => {
    const rows = [
      ["Project ID", "Division", "Sequence"],
      ["H-430-1900", "HPS", 430],
      ["H-431-00", "HPS", 431],
    ]
    const layout = locateProjectTrackerLayout(rows)
    expect(layout).not.toBeNull()
    if (!layout) return

    expect(
      allocateProjectNumber({
        department: "H",
        streetNumber: "3295",
        rows,
        layout,
      })
    ).toBe("H-432-3295")
  })

  it("maps the Project Registry and HPS Tracker live headers", () => {
    const hpsProject: ProjectIntakeTrackerInput = {
      ...PROJECT,
      department: "H",
      projectName: "Thompson Residence",
      clientName: "Scott and Farrell Thompson",
      companyName: null,
      clientFirstName: "Scott",
      clientLastName: "Thompson",
      streetNumber: "3295",
      streetName: "Little Turkey Creek Rd.",
      cityStateZip: "Colorado Springs, CO 80926",
      assignedTo: "Martine Vogel",
    }
    const registryLayout = locateProjectTrackerLayout([
      [
        "Project ID",
        "Division",
        "Sequence",
        "Street Number / Code",
        "Folder Link",
        "Lead Tracker Link",
        "Status",
      ],
    ])
    const trackerLayout = locateProjectTrackerLayout([
      [
        "Project ID",
        "Builder / GC",
        "Contact Person",
        "Estimator",
        "Quote Status",
        "Folder Link",
        "Project Address",
      ],
    ])
    expect(registryLayout).not.toBeNull()
    expect(trackerLayout).not.toBeNull()
    if (!registryLayout || !trackerLayout) return

    const destination = departmentTrackingDestination("H")
    expect(
      buildProjectRegistryRow({
        layout: registryLayout,
        project: hpsProject,
        projectNumber: "H-432-3295",
        driveFolderUrl: "https://drive.google.com/drive/folders/folder-id",
        departmentTrackerUrl: `https://docs.google.com/spreadsheets/d/${destination.spreadsheetId}`,
        createdBy: "Martine Vogel",
      })
    ).toEqual([
      "H-432-3295",
      "HPS",
      "432",
      "3295",
      "https://drive.google.com/drive/folders/folder-id",
      `https://docs.google.com/spreadsheets/d/${destination.spreadsheetId}`,
      "I - Intake",
    ])
    expect(
      buildDepartmentTrackerRow({
        layout: trackerLayout,
        project: hpsProject,
        projectNumber: "H-432-3295",
        driveFolderUrl: "https://drive.google.com/drive/folders/folder-id",
      })
    ).toEqual([
      "H-432-3295",
      "Scott and Farrell Thompson",
      "Scott and Farrell Thompson",
      "Martine Vogel",
      "I - Intake",
      "https://drive.google.com/drive/folders/folder-id",
      "3295 Little Turkey Creek Rd., Colorado Springs, CO 80926",
    ])
  })

  it("keeps Project Number header compatibility without dropping the identifier", () => {
    const registryLayout = locateProjectTrackerLayout([
      ["Project Number", "Division"],
    ])
    const trackerLayout = locateProjectTrackerLayout([
      ["Project Number", "Client"],
    ])
    expect(registryLayout).not.toBeNull()
    expect(trackerLayout).not.toBeNull()
    if (!registryLayout || !trackerLayout) return

    expect(
      buildProjectRegistryRow({
        layout: registryLayout,
        project: PROJECT,
        projectNumber: "O-211-33A",
        driveFolderUrl: null,
        departmentTrackerUrl: "https://example.invalid/tracker",
        createdBy: "Martine Vogel",
      })[0]
    ).toBe("O-211-33A")
    expect(
      buildDepartmentTrackerRow({
        layout: trackerLayout,
        project: PROJECT,
        projectNumber: "O-211-33A",
        driveFolderUrl: null,
      })[0]
    ).toBe("O-211-33A")
  })
})
