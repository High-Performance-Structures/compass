import { describe, expect, it } from "vitest"

import {
  compareProjectDuplicateIdentity,
  findProjectDuplicateCandidates,
  projectDuplicatePairKey,
  type ProjectDuplicateIdentity,
} from "@/lib/project-duplicate-detector"

function project(
  id: string,
  values: Partial<ProjectDuplicateIdentity> = {},
): ProjectDuplicateIdentity {
  return {
    id,
    projectNumber: null,
    name: `Project ${id}`,
    clientName: null,
    address: null,
    sageJobId: null,
    sageJobNumber: null,
    googleDriveFolderId: null,
    buildertrendProjectId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...values,
  }
}

describe("project duplicate detector", () => {
  it("treats shared registry identifiers as high-confidence matches", () => {
    const match = compareProjectDuplicateIdentity(
      project("first", { googleDriveFolderId: "folder-123" }),
      project("second", { googleDriveFolderId: "folder-123" }),
    )

    expect(match).toMatchObject({ score: 100, confidence: "high" })
    expect(match?.reasons.map((reason) => reason.code)).toContain("drive_folder")
  })

  it("combines matching project and client names without overmatching a name alone", () => {
    const first = project("first", {
      name: "Mitchell Residence",
      clientName: "Dan and Jane Mitchell",
    })

    expect(
      compareProjectDuplicateIdentity(
        first,
        project("second", {
          name: "Mitchell Residence",
          clientName: "Dan & Jane Mitchell",
        }),
      ),
    ).toMatchObject({ score: 70, confidence: "medium" })

    expect(
      compareProjectDuplicateIdentity(
        first,
        project("third", { name: "Mitchell Residence" }),
      ),
    ).toBeNull()
  })

  it.each([
    ["H-167-NORTH", "h - 0167 - SOUTH"],
    ["O-202", "o-202-WEST"],
    ["D-2-DESIGN", "D - 2"],
    ["N-1000-SHOP", "n-1000-YARD"],
  ])(
    "treats matching department and sequence as a duplicate signal (%s, %s)",
    (firstProjectNumber, secondProjectNumber) => {
      const match = compareProjectDuplicateIdentity(
        project("first", { projectNumber: firstProjectNumber }),
        project("second", { projectNumber: secondProjectNumber }),
      )

      expect(match).toMatchObject({ score: 100, confidence: "high" })
      expect(match?.reasons.map((reason) => reason.code)).toContain(
        "project_department_sequence",
      )
    },
  )

  it("does not match the same sequence across departments or adjacent sequences", () => {
    expect(
      compareProjectDuplicateIdentity(
        project("first", { projectNumber: "H-167-NORTH" }),
        project("second", { projectNumber: "O-167-NORTH" }),
      ),
    ).toBeNull()
    expect(
      compareProjectDuplicateIdentity(
        project("first", { projectNumber: "H-167-NORTH" }),
        project("second", { projectNumber: "H-168-NORTH" }),
      ),
    ).toBeNull()
  })

  it("does not use an extra-segment cutover number as a governed sequence match", () => {
    expect(
      compareProjectDuplicateIdentity(
        project("cutover", { projectNumber: "N-841-6385-00" }),
        project("approved", { projectNumber: "N-841-55" }),
      ),
    ).toBeNull()
  })

  it("ranks the strongest pair first and creates stable pair keys", () => {
    const candidates = findProjectDuplicateCandidates([
      project("z", { name: "North Main Remodel", clientName: "Acme" }),
      project("a", { name: "North Main Remodel", clientName: "Acme" }),
      project("other", { name: "Unrelated", clientName: "Elsewhere" }),
    ])

    expect(candidates).toHaveLength(1)
    expect(projectDuplicatePairKey("z", "a")).toBe('["a","z"]')
  })
})
