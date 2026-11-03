import { describe, expect, it } from "vitest"

import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import {
  appendWarning,
  customerNeedsSageStatus,
  departmentPrefix,
  hasIncompleteSageClientLink,
  intakeAssigneeName,
  intakeClientName,
  isProjectSequenceConflict,
  joinedAddress,
  metadataFolderName,
  normalizedIntakeDepartment,
  orderedProjectPair,
  projectDepartment,
  projectSequence,
  requireText,
  sageClientJobPayload,
  shellProjectId,
  slugPart,
  unconfirmedDuplicateCandidates,
} from "@/lib/domain/project/rules"

function identity(id: string): ProjectDuplicateCandidate["first"] {
  return {
    id,
    projectNumber: null,
    name: "Lee Residence",
    clientName: null,
    address: null,
    sageJobId: null,
    sageJobNumber: null,
    googleDriveFolderId: null,
    buildertrendProjectId: null,
    createdAt: "2026-10-31T00:00:00.000Z",
  }
}

function candidate(existingId: string): ProjectDuplicateCandidate {
  return {
    first: identity("new"),
    second: identity(existingId),
    score: 90,
    confidence: "high",
    reasons: [{ code: "project_name", label: "Same name", weight: 90 }],
  }
}

describe("project numbering rules", () => {
  it("reads the department sequence", () => {
    expect(projectSequence("O-58-3674")).toBe(58)
    expect(projectSequence("h-7-12")).toBe(7)
    expect(() => projectSequence("58-3674")).toThrow("Compass could not reserve the project sequence.")
  })

  it("recognizes reservation and unique-index conflicts", () => {
    expect(isProjectSequenceConflict(new Error("UNIQUE constraint failed: project_number_reservations.x"))).toBe(true)
    expect(isProjectSequenceConflict(new Error("D1_ERROR: unique constraint failed"))).toBe(true)
    expect(isProjectSequenceConflict(new Error("network"))).toBe(false)
    expect(isProjectSequenceConflict("unique constraint")).toBe(false)
  })

  it("normalizes departments", () => {
    expect(normalizedIntakeDepartment(" o ")).toBe("O")
    expect(normalizedIntakeDepartment("X")).toBeNull()
    expect(normalizedIntakeDepartment(4)).toBeNull()
    expect(projectDepartment("N-3-1")).toBe("N")
    expect(projectDepartment(null)).toBeNull()
  })

  it("builds record ids and slugs", () => {
    expect(slugPart("  O-58 / 3674 Forest Lakes!  ")).toBe("o-58-3674-forest-lakes")
    expect(departmentPrefix("UNASSIGNED")).toBe("unassigned")
    expect(shellProjectId("D-2-10", "D", "Ignored", "abcd1234")).toBe("proj-d-2-10-abcd1234")
    expect(shellProjectId(null, "H", "Shop Roof", "abcd1234")).toBe("proj-h-shop-roof-abcd1234")
  })
})

describe("project intake text rules", () => {
  it("requires text", () => {
    expect(requireText("  Name ", "Project name")).toBe("Name")
    expect(() => requireText("  ", "Client")).toThrow("Client is required")
  })

  it("joins an address and picks the client name", () => {
    expect(joinedAddress({ streetNumber: "12", streetName: "Main St", cityStateZip: "Woodland Park, CO" })).toBe(
      "12 Main St, Woodland Park, CO",
    )
    expect(joinedAddress({ streetNumber: " ", streetName: null, cityStateZip: null })).toBeNull()
    expect(intakeClientName({ clientName: null, clientFirstName: "Ann", clientLastName: "Lee", companyName: "Co" })).toBe("Ann Lee")
    expect(intakeClientName({ clientName: null, clientFirstName: null, clientLastName: null, companyName: " Co " })).toBe("Co")
  })

  it("names assignees and appends warnings", () => {
    expect(intakeAssigneeName({ displayName: null, firstName: "A", lastName: null, email: "a@x" })).toBe("A")
    expect(intakeAssigneeName({ displayName: null, firstName: null, lastName: null, email: "a@x" })).toBe("a@x")
    expect(appendWarning(null, "One.")).toBe("One.")
    expect(appendWarning("One.", "Two.")).toBe("One. Two.")
  })

  it("reads a Drive folder name from link metadata", () => {
    expect(metadataFolderName(JSON.stringify({ folderName: " O-1-2 Job " }))).toBe("O-1-2 Job")
    expect(metadataFolderName("not json")).toBeNull()
    expect(metadataFolderName(null)).toBeNull()
  })
})

describe("duplicate and Sage handoff rules", () => {
  it("orders pairs and filters confirmed candidates", () => {
    expect(orderedProjectPair("b", "a")).toEqual(["a", "b"])
    const candidates = [candidate("p1"), candidate("p2")]
    expect(unconfirmedDuplicateCandidates(candidates, ["p1"]).map((c) => c.second.id)).toEqual(["p2"])
    expect(unconfirmedDuplicateCandidates(candidates, undefined)).toHaveLength(2)
  })

  it("checks Sage client links", () => {
    expect(hasIncompleteSageClientLink(null)).toBe(false)
    expect(hasIncompleteSageClientLink({ sageClientId: "1", sageClientNumber: null })).toBe(true)
    expect(hasIncompleteSageClientLink({ sageClientId: "1", sageClientNumber: "2" })).toBe(false)
    expect(customerNeedsSageStatus({ sageClientStatusId: null, sageClientId: null, sageClientNumber: null })).toBe(true)
    expect(customerNeedsSageStatus({ sageClientStatusId: 1, sageClientId: null, sageClientNumber: null })).toBe(false)
  })

  it("builds the Sage client/job payload with the stored key order", () => {
    const payload = sageClientJobPayload(
      {
        compassCustomerId: "c1",
        sageClientId: null,
        sageClientNumber: null,
        name: "Ann Lee",
        shortNameSource: "Ann Lee",
        company: null,
        email: null,
        phone: null,
        address: "12 Main St",
        billingAddress: "12 Main St",
        notes: null,
        statusId: 1,
      },
      {
        compassProjectId: "p1",
        compassProjectNumber: "O-1-12",
        projectName: "Lee Residence",
        address: "12 Main St",
        statusName: "Current",
        jobType: "customer",
      },
    )
    expect(Object.keys(payload)).toEqual(["operationType", "company", "client", "job"])
    expect(Object.keys(payload.client)).toEqual([
      "compassCustomerId", "sageClientId", "sageClientNumber", "name", "shortName", "company",
      "email", "phone", "address", "billingAddress", "notes", "status",
    ])
    expect(Object.keys(payload.job)).toEqual([
      "compassProjectId", "compassProjectNumber", "name", "shortName", "address", "statusName", "typeName",
    ])
    expect(payload.job.name).toBe("O-1-12-Lee Residence")
  })
})
