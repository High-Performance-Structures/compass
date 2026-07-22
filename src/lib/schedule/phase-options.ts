import { PHASE_LABELS, PHASE_ORDER } from "./phase-colors"
import type { SchedulePhaseOption } from "./types"

function phaseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function phaseLabel(value: string): string {
  const standardPhase = PHASE_ORDER.find((phase) => phase === value)
  return standardPhase ? PHASE_LABELS[standardPhase] : value
}

export function buildSchedulePhaseOptions(
  tasks: readonly { readonly phase: string }[]
): readonly SchedulePhaseOption[] {
  const projectPhases = new Map<
    string,
    { readonly value: string; taskCount: number }
  >()

  for (const task of tasks) {
    const value = task.phase.trim()
    if (!value) continue

    const key = phaseKey(value)
    const existing = projectPhases.get(key)
    if (existing) {
      existing.taskCount += 1
    } else {
      projectPhases.set(key, { value, taskCount: 1 })
    }
  }

  const currentOptions = Array.from(projectPhases.values()).map((phase) => ({
    value: phase.value,
    label: phaseLabel(phase.value),
    taskCount: phase.taskCount,
    projectPhase: true,
  }))

  const unusedStandardOptions = PHASE_ORDER.filter(
    (phase) => !projectPhases.has(phaseKey(phase))
  ).map((phase) => ({
    value: phase,
    label: PHASE_LABELS[phase],
    taskCount: 0,
    projectPhase: false,
  }))

  return [...currentOptions, ...unusedStandardOptions]
}
