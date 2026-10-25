import { z } from "zod/v4"

import { getDb } from "@/db"
import { resolveAgentUser } from "@/lib/agent/agent-user"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@/lib/db"
import { enqueueFeedbackDeskItem } from "@/lib/jarvis/feedback-desk"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"

// Ask Jarvis files a Compass Feedback Desk request for the signed-in person.
// The agent only reaches "file" after the person presses Confirm in the chat
// (see pending-actions.ts), and the reporter always comes from the verified
// token, never from the agent's input.
const fileSchema = z.object({
  action: z.literal("file"),
  kind: z.enum(["bug", "feature", "question", "general", "assistance"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  page: z.string().trim().max(500).optional(),
})

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>
  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) return json({ error: "Unauthorized" }, 401)

  const db = getDb(env.DB)
  const user = await resolveAgentUser(db, auth)
  if (!user || !user.organizationId) return json({ error: "Unauthorized" }, 401)

  const body: unknown = await req.json().catch(() => null)
  const action = typeof body === "object" && body !== null ? Reflect.get(body, "action") : null
  switch (action) {
    case "file":
      break
    default:
      return json({ error: "Unknown feedback action" }, 400)
  }
  const parsed = fileSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: "A request needs a kind, a short title and a description." }, 400)
  }
  const input = parsed.data

  const item = await enqueueFeedbackDeskItem(db, {
    organizationId: user.organizationId,
    source: "ask-jarvis",
    sourceId: crypto.randomUUID(),
    kind: input.kind,
    title: input.title,
    description: input.description,
    reporterName: user.displayName ?? null,
    reporterEmail: user.email.trim().toLowerCase(),
    metadata: {
      externalActorId: user.id,
      authenticatedSubmission: true,
      filedByAskJarvis: true,
      pageUrl: input.page ?? null,
      untrustedUserContent: true,
    },
  })
  try {
    await linkFeedbackDeskItemToGithub(db, env, item)
  } catch (error) {
    console.error("ask_jarvis_feedback_github_link_failed", {
      feedbackDeskItemId: item.id,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }

  return json({
    success: true,
    requestId: item.id,
    status: item.status,
    link: `/dashboard/requests/${encodeURIComponent(item.id)}`,
    message:
      "Filed with the Compass Feedback Desk. The person can follow it in My Requests.",
  })
}
