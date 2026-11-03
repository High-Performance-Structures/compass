
export type GanttScrollMode =
  | "default"
  | "power"

export const DEFAULT_GANTT_SCROLL_MODE: GanttScrollMode = "default"

export function isGanttScrollMode(value: unknown): value is GanttScrollMode {
  return value === "default" || value === "power"
}

export function shouldSynchronizeGanttPanes(mode: GanttScrollMode): boolean {
  return mode === "default"
}
