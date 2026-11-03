import { describe, expect, it } from "vitest"

import {
  driveFolderUrl,
  newPhaseInputError,
  nullableLimitedText,
  phaseAddressParts,
  phaseSummary,
  phaseTrackerInput,
  projectFamilyDepartment,
  quotedSheetRange,
  requiredText,
  trackerPendingWarning,
  type ProjectFamilyPhaseRow,
} from "@/lib/domain/families/rules"

describe("family rules", () => {
  it("validates required and optional text with the form messages", () => {
    expect(requiredText("  Phase 2  ", "Phase name", 200)).toBe("Phase 2")
    expect(() => requiredText("   ", "Phase name", 200)).toThrow("Phase name is required")
    expect(() => requiredText("abc", "Phase name", 2)).toThrow("Phase name must be 2 characters or fewer")
    expect(nullableLimitedText(null, "Description", 10)).toBeNull()
    expect(nullableLimitedText("  ", "Description", 10)).toBeNull()
    expect(() => nullableLimitedText("abcdef", "Description", 3)).toThrow(
      "Description must be 3 characters or fewer",
    )
  })

  it("rejects phase 1 and invalid authorized amounts", () => {
    expect(newPhaseInputError({ sequence: 1, authorizedContractAmountCents: null })).toBe(
      "Additional phase sequence must be 2 or greater; the original project is phase 1.",
    )
    expect(newPhaseInputError({ sequence: 2.5, authorizedContractAmountCents: null })).not.toBeNull()
    expect(newPhaseInputError({ sequence: 2, authorizedContractAmountCents: -1 })).toBe(
      "Authorized contract amount is invalid.",
    )
    expect(newPhaseInputError({ sequence: 2, authorizedContractAmountCents: 1.5 })).toBe(
      "Authorized contract amount is invalid.",
    )
    expect(newPhaseInputError({ sequence: 2, authorizedContractAmountCents: 0 })).toBeNull()
  })

  it("reads the department from the number's first letter", () => {
    expect(projectFamilyDepartment(" o-58-3674-2")).toBe("O")
    expect(projectFamilyDepartment("N-1")).toBe("N")
    expect(projectFamilyDepartment("X-1")).toBeNull()
  })

  it("quotes sheet titles and builds Drive links", () => {
    expect(quotedSheetRange("Bob's Tracker", "A:ZZ")).toBe("'Bob''s Tracker'!A:ZZ")
    expect(driveFolderUrl("abc")).toBe("https://drive.google.com/drive/folders/abc")
  })

  it("splits an address and client name for tracker rows", () => {
    expect(phaseAddressParts("123 Main St, Woodland Park, CO 80863")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
      cityStateZip: "Woodland Park, CO 80863",
    })
    expect(phaseAddressParts(null)).toEqual({ streetNumber: null, streetName: null, cityStateZip: null })
    const tracker = phaseTrackerInput({
      department: "O",
      phaseName: "Phase 2",
      clientName: " Jane  Q Doe ",
      address: "Broadway",
      projectManager: "  ",
      intakeDate: "2026-10-31",
    })
    expect(tracker.clientFirstName).toBe("Jane")
    expect(tracker.clientLastName).toBe("Q Doe")
    expect(tracker.streetName).toBe("Broadway")
    expect(tracker.streetNumber).toBeNull()
    expect(tracker.assignedTo).toBeNull()
    expect(tracker.notes).toBe("Created from an authorized project family phase.")
  })

  it("appends the pending tracker note to an earlier warning", () => {
    expect(trackerPendingWarning(null, new Error("quota"))).toBe("Registry/tracker sync is pending: quota")
    expect(trackerPendingWarning("Drive pending.", "x")).toBe(
      "Drive pending. Registry/tracker sync is pending: Google Sheets could not be updated.",
    )
  })

  it("hides governance fields from users who cannot see every phase", () => {
    const row: ProjectFamilyPhaseRow = {
      phase: {
        id: "ph2",
        familyId: "f1",
        projectId: null,
        projectNumber: "O-1-2",
        googleDriveFolderId: "phase-folder",
        sequence: 2,
        name: "Phase 2",
        description: null,
        jobStatusId: "awaiting_funding",
        originatingChangeOrderId: "co1",
        authorizedContractAmountCents: 1000,
        authorizedAt: "2026-10-01",
        createdBy: null,
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
      },
      customJobStatusLabel: null,
      projectNumber: null,
      phaseProjectNumber: "O-1-2",
      projectName: null,
      projectStatus: null,
      googleDriveFolderId: null,
      phaseGoogleDriveFolderId: "phase-folder",
      changeOrderId: "co1",
      changeOrderNumber: "CO-1",
      changeOrderTitle: "Addition",
      changeOrderStatus: "approved",
      changeOrderAmountCents: 1000,
    }
    const full = phaseSummary(row, true)
    expect(full.projectNumber).toBe("O-1-2")
    expect(full.googleDriveFolderId).toBe("phase-folder")
    expect(full.originatingChangeOrder?.number).toBe("CO-1")
    expect(full.authorizedContractAmountCents).toBe(1000)
    const limited = phaseSummary(row, false)
    expect(limited.originatingChangeOrder).toBeNull()
    expect(limited.authorizedContractAmountCents).toBeNull()
    expect(limited.authorizedAt).toBeNull()
  })
})
