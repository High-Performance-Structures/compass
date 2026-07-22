import type { ScheduleTaskData, TaskStatus } from "./types"

export type ScheduleColorMode = "phase" | "status"
export type ScheduleColorPalette = "hps" | "jobsite" | "high_contrast"

export interface ScheduleColorPreferences {
  readonly mode: ScheduleColorMode
  readonly palette: ScheduleColorPalette
  readonly phaseColors: Readonly<Record<string, string>>
}

export const DEFAULT_SCHEDULE_COLOR_PREFERENCES: ScheduleColorPreferences = {
  mode: "phase",
  palette: "hps",
  phaseColors: {},
}

export const SCHEDULE_COLOR_PALETTES: Readonly<
  Record<ScheduleColorPalette, readonly string[]>
> = {
  hps: [
    "#2f7d4a",
    "#9a7b2f",
    "#245f78",
    "#8a3f35",
    "#556b2f",
    "#6f4d82",
    "#2d6f6a",
    "#9a5d22",
  ],
  jobsite: [
    "#d97706",
    "#2563a5",
    "#3f7d20",
    "#b42318",
    "#7a5c12",
    "#0f766e",
    "#7c3f78",
    "#455a64",
  ],
  high_contrast: [
    "#005a9c",
    "#c43b22",
    "#1b7f3a",
    "#8b3fa0",
    "#b06b00",
    "#007c83",
    "#a52245",
    "#4f5d00",
  ],
}

const STATUS_COLORS: Readonly<Record<TaskStatus, string>> = {
  PENDING: "#5f6b76",
  IN_PROGRESS: "#1769aa",
  COMPLETE: "#2f7d4a",
  BLOCKED: "#b42318",
}

function stableColorIndex(value: string, colorCount: number): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash % colorCount
}

export function schedulePhaseKey(phase: string): string {
  return phase.trim().toLowerCase().replace(/\s+/g, " ")
}

export function isScheduleHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

export function schedulePhaseColor(
  phase: string,
  palette: ScheduleColorPalette,
  phaseColors: Readonly<Record<string, string>> = {}
): string {
  const customColor = phaseColors[schedulePhaseKey(phase)]
  if (customColor && isScheduleHexColor(customColor)) return customColor

  const colors = SCHEDULE_COLOR_PALETTES[palette]
  return colors[stableColorIndex(schedulePhaseKey(phase), colors.length)]
}

export function scheduleTaskColor(
  task: ScheduleTaskData,
  preferences: ScheduleColorPreferences
): string {
  if (preferences.mode === "status") return STATUS_COLORS[task.status]
  return schedulePhaseColor(
    task.phase || "uncategorized",
    preferences.palette,
    preferences.phaseColors
  )
}

export function isScheduleColorMode(value: string): value is ScheduleColorMode {
  return value === "phase" || value === "status"
}

export function isScheduleColorPalette(
  value: string
): value is ScheduleColorPalette {
  return value === "hps" || value === "jobsite" || value === "high_contrast"
}
