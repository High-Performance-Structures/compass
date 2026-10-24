export function cleanScheduleImpactDays(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > 3_650) {
    throw new Error("Schedule impact must be a whole number from 0 to 3650 days")
  }
  return value
}
