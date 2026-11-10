import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { createLeadTimeTodos } from "@/lib/domain/selections/lead-time-todos"
import { sendOverdueFollowUpReminders } from "@/lib/project-follow-up-reminders"

/**
 * Scheduled: remind follow-up owners about jobs whose client follow-up is
 * overdue. Once an hour (the first run of the hour) it also makes the
 * selection lead-time to-dos; every minute of the schedule table is already
 * full, so this due-date check rides along instead of taking its own row.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json({ error: "Maintenance authentication is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }
  try {
    const db = getDb(env.DB)
    const summary = await sendOverdueFollowUpReminders(db)
    let leadTimeTodos: Awaited<ReturnType<typeof createLeadTimeTodos>> | { readonly error: string } | null = null
    if (new Date().getUTCMinutes() < 10) {
      try {
        leadTimeTodos = await createLeadTimeTodos(db)
      } catch (error) {
        // The follow-up reminders already went out; report the lead-time failure alongside them.
        leadTimeTodos = { error: error instanceof Error ? error.message : "Selection lead-time to-dos failed" }
      }
    }
    return Response.json({ success: true, ...summary, leadTimeTodos })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Overdue follow-up reminders failed" },
      { status: 500 },
    )
  }
}
