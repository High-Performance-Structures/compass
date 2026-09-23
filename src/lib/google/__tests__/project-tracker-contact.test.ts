import { describe, expect, it } from "vitest"

import { projectTrackerOwnerContact } from "@/lib/google/project-intake-tracker"

const legacyOwner = {
  projectClientName: "Old Owner",
  assignmentName: "Old Assignment",
  assignmentCompanyName: "Old Company",
  assignmentEmail: "old@example.com",
  assignmentPhone: "303-555-0100",
  canonicalPersonId: null,
  canonicalPersonName: null,
  canonicalPersonEmail: null,
  canonicalPersonPhone: null,
  canonicalCompanyName: null,
}

describe("projectTrackerOwnerContact", () => {
  it("uses the current canonical client person in the existing sheet slots", () => {
    expect(
      projectTrackerOwnerContact({
        ...legacyOwner,
        canonicalPersonId: "person-1",
        canonicalPersonName: "Current Owner",
        canonicalPersonEmail: "current@example.com",
        canonicalPersonPhone: "303-555-0199",
        canonicalCompanyName: "Current Company",
      })
    ).toEqual({
      name: "Current Owner",
      companyName: "Current Company",
      email: "current@example.com",
      phone: "303-555-0199",
    })
  })

  it("does not resurrect an old email when a linked directory field is blank", () => {
    expect(
      projectTrackerOwnerContact({
        ...legacyOwner,
        canonicalPersonId: "person-1",
        canonicalPersonName: "Current Owner",
      })
    ).toEqual({
      name: "Current Owner",
      companyName: "Old Company",
      email: "",
      phone: "",
    })
  })

  it("keeps legacy project intake fields until assignments are reconciled", () => {
    expect(projectTrackerOwnerContact(legacyOwner)).toEqual({
      name: "Old Owner",
      companyName: "Old Company",
      email: "old@example.com",
      phone: "303-555-0100",
    })
  })
})
