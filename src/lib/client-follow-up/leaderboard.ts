import { z } from "zod/v4"

export const CLIENT_FOLLOW_UP_PERIODS = ["week", "month", "30d", "quarter"] as const
export type ClientFollowUpPeriod = (typeof CLIENT_FOLLOW_UP_PERIODS)[number]

export const CLIENT_FOLLOW_UP_PERIOD_LABEL: Readonly<Record<ClientFollowUpPeriod, string>> = {
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
  quarter: "This quarter",
}

export function isClientFollowUpPeriod(value: string): value is ClientFollowUpPeriod {
  return CLIENT_FOLLOW_UP_PERIODS.some((period) => period === value)
}

/** Company settings for the Client follow-up page (Settings → Workflows). */
export const clientFollowUpSettingsSchema = z.object({
  /** Show the team leaderboard (turn off for a non-competitive view). */
  leaderboardEnabled: z.boolean(),
  /** Show each person's run of consecutive business days with logged contact. */
  streaksEnabled: z.boolean(),
  /** Highlight the person with the most logged contacts in the period. */
  highlightLeader: z.boolean(),
  /** Period the page opens on. */
  defaultPeriod: z.enum(CLIENT_FOLLOW_UP_PERIODS),
  /** Count emails Compass sent automatically (e.g. order emails) toward the leaderboard. */
  countAutomaticEmails: z.boolean(),
})

export type ClientFollowUpSettings = z.infer<typeof clientFollowUpSettingsSchema>

export const DEFAULT_CLIENT_FOLLOW_UP_SETTINGS: ClientFollowUpSettings = {
  leaderboardEnabled: true,
  streaksEnabled: true,
  highlightLeader: true,
  defaultPeriod: "week",
  countAutomaticEmails: true,
}

/** Start of the period containing `now` (weeks start Monday), in UTC days. */
export function periodStart(period: ClientFollowUpPeriod, now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  switch (period) {
    case "week": {
      const offset = (day.getUTCDay() + 6) % 7
      return new Date(day.getTime() - offset * 86_400_000)
    }
    case "month":
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
    case "30d":
      return new Date(day.getTime() - 29 * 86_400_000)
    case "quarter":
      return new Date(Date.UTC(day.getUTCFullYear(), Math.floor(day.getUTCMonth() / 3) * 3, 1))
  }
}

export type LeaderboardInteraction = {
  readonly createdBy: string | null
  readonly createdByName: string | null
  readonly interactionType: string
  readonly occurredAt: string
  readonly source: string
}

export type LeaderboardEntry = {
  readonly userId: string
  readonly name: string
  readonly total: number
  readonly byType: Readonly<Record<string, number>>
  readonly streakDays: number
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isWeekend(date: Date): boolean {
  const weekday = date.getUTCDay()
  return weekday === 0 || weekday === 6
}

/**
 * Consecutive business days, ending today (or the last business day if today
 * has nothing yet), with at least one logged contact.
 */
export function streakDays(days: ReadonlySet<string>, now: Date): number {
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // Today doesn't break a streak until it's over.
  if (!days.has(dayKey(cursor)) || isWeekend(cursor)) {
    do cursor = new Date(cursor.getTime() - 86_400_000)
    while (isWeekend(cursor))
  }
  let streak = 0
  for (let guard = 0; guard < 400; guard += 1) {
    if (isWeekend(cursor)) {
      cursor = new Date(cursor.getTime() - 86_400_000)
      continue
    }
    if (!days.has(dayKey(cursor))) break
    streak += 1
    cursor = new Date(cursor.getTime() - 86_400_000)
  }
  return streak
}

/**
 * Per-person totals for the period (by interaction type) plus streaks from the
 * wider history. Only completed interaction records reach this, so the board
 * rewards real contact; records without a person are left out.
 */
export function buildLeaderboard(input: {
  readonly periodInteractions: readonly LeaderboardInteraction[]
  readonly streakInteractions: readonly LeaderboardInteraction[]
  readonly countAutomaticEmails: boolean
  readonly now: Date
}): readonly LeaderboardEntry[] {
  const counted = (item: LeaderboardInteraction): item is LeaderboardInteraction & { readonly createdBy: string } =>
    item.createdBy !== null && (input.countAutomaticEmails || item.source === "manual")
  const entries = new Map<string, { name: string; total: number; byType: Record<string, number> }>()
  for (const item of input.periodInteractions) {
    if (!counted(item)) continue
    const entry = entries.get(item.createdBy) ?? { name: item.createdByName ?? "Team member", total: 0, byType: {} }
    entry.total += 1
    entry.byType[item.interactionType] = (entry.byType[item.interactionType] ?? 0) + 1
    entries.set(item.createdBy, entry)
  }
  const daysByUser = new Map<string, Set<string>>()
  for (const item of input.streakInteractions) {
    if (!counted(item)) continue
    const date = new Date(item.occurredAt)
    if (Number.isNaN(date.getTime())) continue
    const set = daysByUser.get(item.createdBy) ?? new Set<string>()
    set.add(dayKey(date))
    daysByUser.set(item.createdBy, set)
  }
  return [...entries.entries()]
    .map(([userId, entry]) => ({
      userId,
      name: entry.name,
      total: entry.total,
      byType: entry.byType,
      streakDays: streakDays(daysByUser.get(userId) ?? new Set(), input.now),
    }))
    .sort((a, b) => b.total - a.total || b.streakDays - a.streakDays || a.name.localeCompare(b.name))
}
