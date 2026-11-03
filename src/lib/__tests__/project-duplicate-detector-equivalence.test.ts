import { describe, expect, it } from "vitest"

import {
  compareProjectDuplicateIdentity,
  findProjectDuplicateCandidates,
  type ProjectDuplicateIdentity,
} from "@/lib/project-duplicate-detector"

import {
  compareProjectDuplicateIdentity as legacyCompare,
  findProjectDuplicateCandidates as legacyFind,
} from "./fixtures/legacy-project-duplicate-detector"

// The detector normalizes each project once instead of once per pair. This
// compares it with the previous per-pair implementation (a frozen copy) on a
// registry mixing every kind of collision the detector knows.
const PROJECT_NUMBERS = [
  null, "BT-LEAD-1", "BT-LEAD-2", "BT-LEAD-21843125", "D-26-33", "H-167-NORTH", "H-168-NORTH",
  "H-278-1602", "H-331-461", "H-340-461", "H-416-6385", "H-420-00", "H-425-1552", "N-440-1602",
  "N-814-6385", "N-821-11828", "N-841-55", "N-841-6385-00", "N-900-6385", "N-920-0", "O-120-3790",
  "O-121-3790", "O-58-3674", "o - 58 - 3674", "N-821-11828-2", "H-331-461-1",
]
const NAMES = [
  "Byrd Residence", "Different work", "Grandview Construction", "Grandview Design",
  "H-278-1602 Co Rd 51 - Skinner Residence", "H-331-461 Ziehler", "H-340-461 Ziehler",
  "N-821-11828 Bracing Rental", "N-821-11828 Fox Block Order", "N-841-55-Justin Blank Fox Blocks Portion",
  "Mitchell Residence", "Mitchell  Residence!", "North Main Remodel", "Richards Fox Blocks",
  "Skinner Fox Blocks", "Vance Residence", "Waterbarrel Pour Help", "Résidence Café", "Pour",
]
const CLIENTS = [null, "", "Acme", "Dan & Jane Mitchell", "Dan and Jane Mitchell", "Mitchell", "Richards", "Skinner"]
const ADDRESSES = [null, "11085 Ridge Rd", "11085 ridge rd.", "33 Grand View Circle", "1602 Co Rd 51"]
const IDS = [null, "", "100", " 100 ", "200", "abc-1"]
const DATES = ["2026-01-01T00:00:00.000Z", "2026-01-01T06:00:00.000Z", "2026-03-15T00:00:00.000Z", "not a date"]

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function registry(size: number, seed: number): ProjectDuplicateIdentity[] {
  const random = seeded(seed)
  const pick = <T,>(values: readonly T[]): T => {
    const value = values[Math.floor(random() * values.length)]
    if (value === undefined) throw new Error("empty fixture list")
    return value
  }
  return Array.from({ length: size }, (_, index) => ({
    id: `project-${seed}-${index}`,
    projectNumber: pick(PROJECT_NUMBERS),
    name: pick(NAMES),
    clientName: pick(CLIENTS),
    address: pick(ADDRESSES),
    sageJobId: pick(IDS),
    sageJobNumber: pick(IDS),
    googleDriveFolderId: pick(IDS),
    buildertrendProjectId: pick(IDS),
    createdAt: pick(DATES),
  }))
}

describe("project duplicate detector equivalence", () => {
  for (const seed of [1, 7, 42]) {
    const projects = registry(140, seed)

    it(`finds the same candidates as before (seed ${seed})`, () => {
      for (const repeatOrderDepartments of [new Set<string>(), new Set(["N"]), new Set(["N", "H"])]) {
        const expected = legacyFind(projects, { repeatOrderDepartments })
        expect(expected.length).toBeGreaterThan(0)
        expect(findProjectDuplicateCandidates(projects, { repeatOrderDepartments })).toEqual(expected)
      }
    })

    it(`compares every pair the same as before (seed ${seed})`, () => {
      for (const first of projects.slice(0, 40)) {
        for (const second of projects) {
          expect(compareProjectDuplicateIdentity(first, second)).toEqual(legacyCompare(first, second))
        }
      }
    })
  }
})
