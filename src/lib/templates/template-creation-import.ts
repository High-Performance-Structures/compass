import { PHASE_LABELS, PHASE_ORDER } from "@/lib/schedule/phase-colors"
import type { ConstructionPhase } from "@/lib/schedule/types"

const GENERIC_PHASES = new Set(["", "general", "none", "unassigned", "unassigned general"])

function normalizedWords(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function phaseFromText(value: string | null): ConstructionPhase | null {
  const normalized = normalizedWords(value)
  if (!normalized || GENERIC_PHASES.has(normalized)) return null

  const exact = PHASE_ORDER.find(
    (phase) =>
      normalizedWords(phase) === normalized || normalizedWords(PHASE_LABELS[phase]) === normalized
  )
  if (exact) return exact

  // Later construction phases win when a captured Buildertrend label combines
  // phases, such as "Insulation & Drywall".
  return (
    [...PHASE_ORDER]
      .reverse()
      .find((phase) => normalized.includes(normalizedWords(PHASE_LABELS[phase]))) ?? null
  )
}

export function resolveTemplateSchedulePhase(input: {
  readonly capturedPhase: string | null
  readonly tradeCategory: string | null
}): ConstructionPhase {
  return (
    phaseFromText(input.capturedPhase) ?? phaseFromText(input.tradeCategory) ?? "preconstruction"
  )
}

export function parseTemplateChoiceOptions(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((option) => {
      if (typeof option !== "string") return []
      const cleaned = option.trim()
      return cleaned ? [cleaned] : []
    })
  } catch {
    return []
  }
}
