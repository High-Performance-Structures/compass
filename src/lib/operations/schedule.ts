/**
 * Scheduled jobs: WHEN each background job runs.
 *
 * Cloudflare wakes Compass once a minute (the single `* * * * *` cron in
 * wrangler.jsonc). Each minute, `custom-worker.ts` asks this file which jobs
 * are due and runs them one after another, never all at once, so a single
 * Worker never holds several big jobs in memory together (the 128 MB limit).
 *
 * To change a schedule, edit the table below by hand:
 *   - everyMinutes: how often the job runs. Must divide 60 evenly
 *     (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 or 60).
 *   - offsetMinute: which minute inside that cycle it runs, from 0 up to
 *     everyMinutes - 1. A job with everyMinutes 10 and offsetMinute 3 runs
 *     at :03, :13, :23, :33, :43 and :53.
 *   - heavy: true for jobs that render PDFs, call Google, or fetch big
 *     outside data. Keep heavy jobs on different minutes (the tests check it).
 *   - why: one line on why it needs that cadence.
 *
 * Spreading the offsets keeps any one minute to inbound email plus at most
 * two other jobs. `src/lib/operations/__tests__/schedule.test.ts` fails if a
 * change breaks those rules, and prints which minute is too busy.
 *
 * To add a job: add its signed `/api/operations/*` route, then a row here.
 * The `call` column says how custom-worker.ts signs the request:
 *   "signed"   - signed empty POST (almost every job)
 *   "feedback" - signed JSON POST (feedback reconciliation only)
 *   "gmail"    - bearer-token POST (inbound email sync only)
 */

type ScheduledJobCall = "signed" | "feedback" | "gmail"

export type ScheduledJob = {
  readonly name: string
  readonly path: string
  readonly call: ScheduledJobCall
  readonly everyMinutes: number
  readonly offsetMinute: number
  readonly heavy: boolean
  readonly why: string
}

// Rows run in this order when several are due in the same minute.
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  // ── Every minute ─────────────────────────────────────────────────────────
  {
    name: "inbound email sync",
    path: "/api/email/gmail-sync",
    call: "gmail",
    everyMinutes: 1,
    offsetMinute: 0,
    heavy: true,
    why: "Replies to project conversations should appear within a minute.",
  },

  // ── Every 5 minutes (minutes :00 :05 :10 ... plus the offset) ───────────
  {
    name: "project paper trail",
    path: "/api/operations/paper-trail/run",
    call: "signed",
    everyMinutes: 5,
    offsetMinute: 0,
    heavy: true,
    why: "Drive copies already wait the company's quiet period; 5 minutes more is unnoticeable.",
  },
  {
    name: "My Compass calendars",
    path: "/api/operations/my-compass-calendar/sync",
    call: "signed",
    everyMinutes: 5,
    offsetMinute: 1,
    heavy: true,
    why: "Each person's Google calendar was already refreshed at most every 5 minutes.",
  },
  {
    name: "invitation email recovery",
    path: "/api/operations/email/retry-invitations",
    call: "signed",
    everyMinutes: 5,
    offsetMinute: 2,
    heavy: false,
    why: "Only retries invitations whose first send failed; the first send is immediate.",
  },
  {
    name: "project calendars",
    path: "/api/operations/project-calendars/sync",
    call: "signed",
    everyMinutes: 5,
    offsetMinute: 3,
    heavy: true,
    why: "Each job calendar was already refreshed at most every 5 minutes.",
  },
  {
    name: "Sage Square manual receipts",
    path: "/api/operations/sage/square-receipts",
    call: "signed",
    everyMinutes: 5,
    offsetMinute: 4,
    heavy: false,
    why: "Accounting checks receipts during the day; reminders recheck every 10 minutes anyway.",
  },

  // ── Every 10 minutes (minutes :00 :10 :20 ... plus the offset) ──────────
  {
    name: "GoTo message recovery",
    path: "/api/operations/goto/recover-message-bodies",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 1,
    heavy: false,
    why: "Back-fills old text-message bodies; nobody is waiting on it.",
  },
  {
    name: "Weather and fire",
    path: "/api/operations/weather/refresh",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 2,
    heavy: true,
    why: "Weather warnings change on a 10-minute scale; a few forecasts per run.",
  },
  {
    name: "Message Desk stale reminders",
    path: "/api/operations/staff-message-desk/stale-reminders",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 3,
    heavy: false,
    why: "Reminds about messages left unanswered for hours; 10 minutes is close enough.",
  },
  {
    name: "Today's plan",
    path: "/api/operations/morning-plan/sweep",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 4,
    heavy: false,
    why: "Sends each person's plan once a day at their hour, within 10 minutes of it.",
  },
  {
    name: "Project follow-up overdue reminders",
    path: "/api/operations/project-follow-up/overdue-reminders",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 6,
    heavy: false,
    why: "Follow-ups are due by the day; 10 minutes late is unnoticeable.",
  },
  {
    name: "Client meeting transcripts",
    path: "/api/operations/client-meetings/transcripts",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 7,
    heavy: true,
    why: "Google needs about 10 minutes after a meeting before the transcript is ready.",
  },
  {
    name: "Missing daily log reminders",
    path: "/api/operations/daily-logs/missing-reminders",
    call: "signed",
    everyMinutes: 10,
    offsetMinute: 8,
    heavy: false,
    why: "Each person once a day, within 10 minutes after their reminder time.",
  },
  {
    name: "feedback reconciliation",
    path: "/api/operations/feedback/reconcile",
    call: "feedback",
    everyMinutes: 10,
    offsetMinute: 9,
    heavy: false,
    why: "Tidies the Feedback Desk; the admin page calls it stale after 15 minutes.",
  },

  // ── Every 15 minutes (health checks) ─────────────────────────────────────
  {
    name: "Sage bridge health",
    path: "/api/operations/sage/health",
    call: "signed",
    everyMinutes: 15,
    offsetMinute: 5,
    heavy: false,
    why: "Alerts admins when the Sage bridge on the office PC stops; 15 minutes is soon enough.",
  },
  {
    name: "Square authentication health",
    path: "/api/operations/square/auth-health",
    call: "signed",
    everyMinutes: 15,
    offsetMinute: 10,
    heavy: false,
    why: "Alerts if the Square login is rejected; a rare event, 15 minutes is soon enough.",
  },
]

/** The jobs due at this minute, in table order. Uses UTC minutes of the hour. */
export function jobsDueAt(
  time: Date,
  jobs: readonly ScheduledJob[] = SCHEDULED_JOBS
): ScheduledJob[] {
  const minute = time.getUTCMinutes()
  return jobs.filter((job) => minute % job.everyMinutes === job.offsetMinute)
}

/** How often a job runs, in minutes. Throws if the name is not in the table. */
export function scheduledEveryMinutes(name: string): number {
  const job = SCHEDULED_JOBS.find((row) => row.name === name)
  if (!job) throw new Error(`No scheduled job named ${name}`)
  return job.everyMinutes
}
