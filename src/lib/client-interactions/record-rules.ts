import type { ClientInteractionSettings } from "@/lib/feature-settings/registry"

/** Allowance for clock differences between the browser and the server. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Why a client-contact record isn't complete enough to count as contact, or
 * null when it is. A record needs a written outcome and a believable date.
 */
export function clientInteractionRecordProblem(
  input: { readonly summary: string; readonly occurredAt: string },
  settings: ClientInteractionSettings,
  now: Date = new Date(),
): string | null {
  const summary = input.summary.trim()
  if (summary.length < settings.minimumSummaryCharacters) {
    return `Describe what happened in at least ${settings.minimumSummaryCharacters} characters (who you spoke with, what was said or sent, next step).`
  }
  const occurred = new Date(input.occurredAt)
  if (Number.isNaN(occurred.getTime())) return "Enter when the contact happened."
  if (occurred.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return "A contact can't be logged in the future."
  if (occurred.getTime() < now.getTime() - settings.maximumBackdateDays * DAY_MS) {
    return `Contacts can be backdated at most ${settings.maximumBackdateDays} days.`
  }
  return null
}
