// The custom colors a person picked most recently for schedule items, newest
// first. Palette colors are named ("blue"), custom ones are "#rrggbb".

export const RECENT_SCHEDULE_COLORS_KEY = "compass:schedule-recent-colors"
export const MAX_RECENT_SCHEDULE_COLORS = 6

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isCustomScheduleColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

/** Reads a stored list, keeping only valid, distinct custom colors. */
export function parseRecentScheduleColors(stored: string | null): readonly string[] {
  if (!stored) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    const colors: string[] = []
    for (const value of parsed) {
      if (typeof value !== "string" || !isCustomScheduleColor(value)) continue
      const color = value.toLowerCase()
      if (!colors.includes(color)) colors.push(color)
    }
    return colors.slice(0, MAX_RECENT_SCHEDULE_COLORS)
  } catch {
    return []
  }
}

/** Moves a custom color to the front; palette colors leave the list as is. */
export function rememberRecentScheduleColor(
  recent: readonly string[],
  color: string
): readonly string[] {
  if (!isCustomScheduleColor(color)) return recent
  const value = color.toLowerCase()
  return [value, ...recent.filter((item) => item !== value)].slice(0, MAX_RECENT_SCHEDULE_COLORS)
}
