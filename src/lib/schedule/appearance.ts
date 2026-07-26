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
  readonly buttonClassName: string
}[] = [
  { value: "blue", label: "Blue", buttonClassName: "bg-blue-500" },
  { value: "green", label: "Green", buttonClassName: "bg-green-500" },
  { value: "orange", label: "Orange", buttonClassName: "bg-orange-500" },
  { value: "purple", label: "Purple", buttonClassName: "bg-purple-500" },
  { value: "red", label: "Red", buttonClassName: "bg-red-500" },
  { value: "yellow", label: "Yellow", buttonClassName: "bg-yellow-500" },
  { value: "teal", label: "Teal", buttonClassName: "bg-teal-500" },
  { value: "gray", label: "Gray", buttonClassName: "bg-gray-500" },
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
  return palette[normalizeDisplayColor(item.displayColor)]
}

export function getScheduleItemClasses(item: {
  readonly displayColor: string | null | undefined
  readonly isCriticalPath: boolean
  readonly isMilestone: boolean
}): string[] {
  const classes = [`display-color-${normalizeDisplayColor(item.displayColor)}`]

  if (item.isCriticalPath) classes.push("critical-path")
  if (item.isMilestone) classes.push("milestone")

  return classes
}
