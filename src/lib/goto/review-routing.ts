export function isInboundSmsTodoDestination(
  value: string
): value is "todo" | "delivery" {
  return value === "todo" || value === "delivery"
}

export function normalizeInboundSmsTodoDueDate(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null

  const parsed = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null
}
