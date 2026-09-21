import {
  baseProjectNumber,
  projectNumberParts,
} from "@/lib/project-profile"

/**
 * Family sequence 1 is the original project. Additional phases use the
 * one-based suffix requested by operations: sequence 2 becomes -1, sequence
 * 3 becomes -2, and so on.
 */
export function projectFamilyPhaseNumber(sequence: number): number | null {
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null
  return sequence === 1 ? null : sequence - 1
}

export function projectFamilyProjectNumber(
  familyBaseNumber: string,
  sequence: number,
): string | null {
  const base = baseProjectNumber(familyBaseNumber)
  const phaseNumber = projectFamilyPhaseNumber(sequence)
  if (!base || phaseNumber === null) return sequence === 1 ? base : null
  return `${base}-${phaseNumber}`
}

export function projectFamilyPhaseDriveFolderName(input: {
  readonly projectNumber: string
  readonly phaseName: string
}): string {
  const projectNumber = input.projectNumber.trim()
  const phaseName = input.phaseName
    .replace(/[/:\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  if (!projectNumber) throw new Error("A phased project number is required.")
  if (!phaseName) throw new Error("A phase name is required.")
  return `${projectNumber} - ${phaseName}`
}

export function isPhasedProjectNumber(value: string): boolean {
  const parts = projectNumberParts(value)
  return parts !== null && /^(?:[OHND])-\d+-[A-Z0-9]+-\d+$/i.test(value.trim())
}
