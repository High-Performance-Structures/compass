export const DISPLAY_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "yellow",
  "teal",
  "gray",
] as const

export type DisplayColor = (typeof DISPLAY_COLORS)[number]
export type DisplayColorPalette = Record<DisplayColor, string>

export const DEFAULT_DISPLAY_COLOR_PALETTE: DisplayColorPalette = {
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f97316",
  purple: "#a855f7",
  red: "#ef4444",
  yellow: "#eab308",
  teal: "#14b8a6",
  gray: "#6b7280",
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isCustomDisplayColor(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && HEX_COLOR.test(value)
}

export function normalizeDisplayColorPalette(
  palette: Partial<Record<DisplayColor, string>> | null | undefined
): DisplayColorPalette {
  return Object.fromEntries(
    DISPLAY_COLORS.map((color) => [
      color,
      palette?.[color] && HEX_COLOR.test(palette[color])
        ? palette[color].toLowerCase()
        : DEFAULT_DISPLAY_COLOR_PALETTE[color],
    ])
  ) as DisplayColorPalette
}

export function schedulePaletteStorageKey(projectId: string): string {
  return `compass:schedule-display-palette:${projectId}`
}

export const DEFAULT_DISPLAY_COLOR_LABELS: Record<DisplayColor, string> = {
  blue: "Standard work",
  green: "Field work",
  orange: "Review / inspection",
  purple: "Coordination",
  red: "At-risk / blocker",
  yellow: "Owner decision",
  teal: "External dependency",
  gray: "Deferred / noncritical",
}

export function schedulePaletteLabelStorageKey(projectId: string): string {
  return `compass:schedule-display-labels:${projectId}`
}

export const DEFAULT_DISPLAY_COLOR: DisplayColor = "blue"

export const DISPLAY_COLOR_OPTIONS: readonly {
  readonly value: DisplayColor
  readonly label: string
}[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "purple", label: "Purple" },
  { value: "red", label: "Red" },
  { value: "yellow", label: "Yellow" },
  { value: "teal", label: "Teal" },
  { value: "gray", label: "Gray" },
] as const

function isDisplayColor(value: string | null | undefined): value is DisplayColor {
  return typeof value === "string" && DISPLAY_COLORS.includes(value as DisplayColor)
}

export function normalizeDisplayColor(
  value: string | null | undefined
): DisplayColor {
  return isDisplayColor(value) ? value : DEFAULT_DISPLAY_COLOR
}

export function getScheduleItemDisplayColor(
  item: { readonly displayColor: string | null | undefined },
  palette: DisplayColorPalette = DEFAULT_DISPLAY_COLOR_PALETTE
): string {
  if (isCustomDisplayColor(item.displayColor)) {
    return item.displayColor.toLowerCase()
  }
  return palette[normalizeDisplayColor(item.displayColor)]
}

export function getScheduleItemClasses(item: {
  readonly displayColor: string | null | undefined
  readonly isCriticalPath: boolean
  readonly isMilestone: boolean
}): string[] {
  const classes = [
    isCustomDisplayColor(item.displayColor)
      ? "display-color-custom"
      : `display-color-${normalizeDisplayColor(item.displayColor)}`
  ]

  if (item.isCriticalPath) classes.push("critical-path")
  if (item.isMilestone) classes.push("milestone")

  return classes
}
