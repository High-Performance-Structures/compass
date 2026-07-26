import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { feedback } from "@/db/schema"
import { sql } from "drizzle-orm"
import { enqueueFeedbackDeskItem } from "@/lib/jarvis/feedback-desk"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"

const FEEDBACK_TYPES = ["bug", "feature", "question", "general"] as const

function isFeedbackType(
  value: string,
): value is (typeof FEEDBACK_TYPES)[number] {
  return FEEDBACK_TYPES.some((type) => type === value)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { type, message, name, email, pageUrl, userAgent, viewportWidth, viewportHeight } = body as {
    type: string
    message: string
    name?: string
    email?: string
    pageUrl?: string
    userAgent?: string
    viewportWidth?: number
    viewportHeight?: number
  }

  if (!isFeedbackType(type)) {
    return Response.json(
      { error: "Invalid type. Must be: bug, feature, question, or general" },
      { status: 400 },
    )
  }
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "Message is required" }, { status: 400 })
  }
  if (message.length > 2000) {
    return Response.json(
      { error: "Message must be 2000 characters or less" },
      { status: 400 },
    )
  }

  const { env, cf } = await getCloudflareContext()
  const db = getDb(env.DB)

  const ip = (cf as { request?: Request })?.request?.headers?.get("cf-connecting-ip")
    ?? request.headers.get("cf-connecting-ip")
    ?? "unknown"
  const ipHash = await hashIp(ip)

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recentSubmissions = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedback)
    .where(
      sql`${feedback.ipHash} = ${ipHash} AND ${feedback.createdAt} > ${oneHourAgo}`,
    )

  if ((recentSubmissions[0]?.count ?? 0) >= 5) {
    return Response.json(
      { error: "Too many submissions. Please try again later." },
      { status: 429 },
    )
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await db.insert(feedback).values({
    id,
    type,
    message: message.trim(),
    name: name?.trim() || null,
    email: email?.trim() || null,
    pageUrl: pageUrl || null,
    userAgent: userAgent || null,
    viewportWidth: viewportWidth || null,
    viewportHeight: viewportHeight || null,
    ipHash,
    createdAt,
  })

  const githubIssueUrl = await createGithubIssue(env, db, id, {
    type,
    message: message.trim(),
    name: name?.trim(),
    email: email?.trim(),
    pageUrl,
    userAgent,
    viewportWidth,
    viewportHeight,
    createdAt,
  })

  try {
    await enqueueFeedbackDeskItem(db, {
      organizationId: getJarvisEnvValue(
        env,
        "JARVIS_BRIDGE_ORGANIZATION_ID",
      ),
      source: "feedback-widget",
      sourceId: id,
      kind: type,
      title: message.trim().slice(0, 160),
      description: message.trim(),
      reporterName: name?.trim(),
      reporterEmail: email?.trim(),
      githubIssueUrl,
      metadata: {
        pageUrl: pageUrl ?? null,
        userAgent: userAgent ?? null,
        viewportWidth: viewportWidth ?? null,
        viewportHeight: viewportHeight ?? null,
        untrustedUserContent: true,
      },
    })
  } catch (error) {
    console.error("feedback_desk_enqueue_failed", {
      feedbackId: id,
      error:
        error instanceof Error ? error.message : "Unknown error",
    })
  }

  return Response.json({ success: true })
}

async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(ip)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}

const LABEL_MAP: Record<string, string> = {
  bug: "bug",
  feature: "enhancement",
  question: "question",
  general: "feedback",
}

async function createGithubIssue(
  env: CloudflareEnv,
  db: ReturnType<typeof getDb>,
  feedbackId: string,
  data: {
    type: string
    message: string
    name?: string
    email?: string
    pageUrl?: string
    userAgent?: string
    viewportWidth?: number
    viewportHeight?: number
    createdAt: string
  },
): Promise<string | null> {
  const token =
    getJarvisEnvValue(env, "GITHUB_TOKEN") ??
    process.env.GITHUB_TOKEN
  const repo =
    getJarvisEnvValue(env, "GITHUB_REPO") ??
    process.env.GITHUB_REPO
  if (!token || !repo) return null

  const titlePrefix = `[${data.type}]`
  const titleMessage = data.message.slice(0, 60) + (data.message.length > 60 ? "..." : "")
  const title = `${titlePrefix} ${titleMessage}`

  const fromLine = data.name
    ? `${data.name}${data.email ? ` (${data.email})` : ""}`
    : `Anonymous${data.email ? ` (${data.email})` : ""}`

  const body = `## Feedback: ${data.type}

${data.message}

---

**From:** ${fromLine}
**Page:** ${data.pageUrl || "Unknown"}
**Viewport:** ${data.viewportWidth || "?"}x${data.viewportHeight || "?"}
**User Agent:** ${data.userAgent || "Unknown"}
**Timestamp:** ${data.createdAt}`

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "compass-feedback-widget",
      },
      body: JSON.stringify({
        title,
        body,
        labels: [LABEL_MAP[data.type] || "feedback"],
      }),
    })

    if (res.ok) {
      const issue: unknown = await res.json()
      const issueUrl =
        typeof issue === "object" &&
        issue !== null &&
        "html_url" in issue &&
        typeof issue.html_url === "string"
          ? issue.html_url
          : null
      if (!issueUrl) return null

      await db
        .update(feedback)
        .set({ githubIssueUrl: issueUrl })
        .where(sql`${feedback.id} = ${feedbackId}`)
      return issueUrl
    }
  } catch (error) {
    // non-blocking: don't fail the feedback submission
    console.error("feedback_github_issue_failed", {
      feedbackId,
      error:
        error instanceof Error ? error.message : "Unknown error",
    })
  }

  return null
}
