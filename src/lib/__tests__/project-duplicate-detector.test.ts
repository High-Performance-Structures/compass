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

  it("compares project names without their governed number prefixes", () => {
    const match = compareProjectDuplicateIdentity(
      project("first", {
        projectNumber: "H-331-461",
        name: "H-331-461 Ziehler",
        clientName: "Mike Ziehler",
      }),
      project("second", {
        projectNumber: "H-340-461",
        name: "H-340-461 Ziehler",
        clientName: "Mike Ziehler",
      }),
    )

    expect(match).toMatchObject({ score: 100, confidence: "high" })
    expect(match?.reasons.map((reason) => reason.code)).toEqual([
      "project_name",
      "client_name",
      "project_location_suffix",
    ])
  })

  it("uses a shared nonzero location suffix only with another identity signal", () => {
    const first = project("first", {
      projectNumber: "H-416-6385",
      name: "Peterson Truss",
      clientName: "Jake Peterson",
    })

    expect(
      compareProjectDuplicateIdentity(
        first,
        project("second", {
          projectNumber: "N-814-6385",
          name: "Waterbarrel Pour Help",
          clientName: "Jake Peterson",
        }),
      ),
    ).toMatchObject({ score: 60, confidence: "medium" })

    expect(
      compareProjectDuplicateIdentity(
        first,
        project("third", {
          projectNumber: "N-900-6385",
          name: "Unrelated project",
        }),
      ),
    ).toBeNull()
    expect(
      compareProjectDuplicateIdentity(
        project("zero-a", {
          projectNumber: "H-420-00",
          name: "First scope",
          clientName: "Repeat client",
        }),
        project("zero-b", {
          projectNumber: "N-920-0",
          name: "Different work",
          clientName: "Repeat client",
        }),
      ),
    ).toBeNull()
  })

  it("does not double-count a location suffix when the full address matches", () => {
    const match = compareProjectDuplicateIdentity(
      project("first", {
        projectNumber: "D-26-33",
        name: "Grandview Design",
        clientName: "Mitchell",
        address: "33 Grand View Circle",
      }),
      project("second", {
        projectNumber: "O-210-33",
        name: "Grandview Construction",
        clientName: "Mitchell",
        address: "33 Grand View Circle",
      }),
    )

    expect(match).toMatchObject({ score: 80 })
    expect(match?.reasons.map((reason) => reason.code)).not.toContain(
      "project_location_suffix",
    )
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

  it("uses an explicit governed number at the start of a Buildertrend project name", () => {
    const match = compareProjectDuplicateIdentity(
      project("buildertrend", {
        projectNumber: "BT-LEAD-21843125",
        name: "N-841-55-Justin Blank Fox Blocks Portion",
      }),
      project("approved", {
        projectNumber: "N-841-55",
        name: "Hedges Circle - Justin Blank",
      }),
    )

    expect(match).toMatchObject({ score: 100, confidence: "high" })
    expect(match?.reasons.map((reason) => reason.code)).toContain(
      "project_department_sequence",
    )
  })

  it("flags a number collision when suffixes and project names differ", () => {
    const match = compareProjectDuplicateIdentity(
      project("first", {
        projectNumber: "H-425-1552",
        name: "Ogletree Budget Estimate",
      }),
      project("second", {
        projectNumber: "H-425-515",
        name: "Marquis LiteDeck",
      }),
    )

    expect(match).toMatchObject({ score: 100, confidence: "high" })
    expect(match?.reasons).toEqual([
      {
        code: "project_department_sequence",
        label: "Same project department and sequence",
        weight: 100,
      },
    ])
  })

  it("uses one governed anchor for a multi-record Buildertrend collision group", () => {
    const candidates = findProjectDuplicateCandidates([
      project("approved", {
        projectNumber: "N-821-11828",
        name: "Byrd Residence",
      }),
      project("bt-1", {
        projectNumber: "BT-LEAD-1",
        name: "N-821-11828 Fox Block Order",
      }),
      project("bt-2", {
        projectNumber: "BT-LEAD-2",
        name: "N-821-11828 Bracing Rental",
      }),
      project("bt-3", {
        projectNumber: "BT-LEAD-3",
        name: "N-821-11828 Pour Help",
      }),
    ])

    expect(candidates).toHaveLength(3)
    expect(
      candidates.every(
        (candidate) =>
          candidate.first.id === "approved" ||
          candidate.second.id === "approved",
      ),
    ).toBe(true)
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
