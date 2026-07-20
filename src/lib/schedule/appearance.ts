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
