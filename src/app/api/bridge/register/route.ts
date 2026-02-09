import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { validateApiKey } from "@/lib/mcp/auth"
import { loadMemoriesForPrompt } from "@/lib/agent/memory"
import { getAvailableTools } from "@/lib/mcp/tool-adapter"
import {
  getCustomDashboards,
} from "@/app/actions/dashboards"
import {
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"
import type { BridgeRegisterResponse } from "@/lib/mcp/types"

function extractBearer(
  req: NextRequest,
): string | null {
  const header = req.headers.get("authorization")
  if (!header) return null
  const parts = header.split(" ")
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null
  }
  return parts[1] ?? null
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse> {
  const token = extractBearer(req)
  if (!token) {
    return NextResponse.json(
      { error: "missing or malformed authorization" },
      { status: 401 },
    )
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const result = await validateApiKey(db, token)
  if (!result.valid) {
    return NextResponse.json(
      { error: result.error },
      { status: 401 },
    )
  }

  const userRow = await db
    .select()
    .from(users)
    .where(eq(users.id, result.userId))
    .get()

  if (!userRow) {
    return NextResponse.json(
      { error: "user not found" },
      { status: 404 },
    )
  }

  const [memories, dashboardResult, skillsResult] =
    await Promise.all([
      loadMemoriesForPrompt(db, result.userId),
      getCustomDashboards(),
      getInstalledSkillsAction(),
    ])

  const tools = getAvailableTools(result.scopes)

  const response: BridgeRegisterResponse = {
    user: {
      id: userRow.id,
      name:
        userRow.displayName ??
        userRow.email.split("@")[0] ??
        "User",
      email: userRow.email,
      role: userRow.role,
    },
    tools,
    memories: memories
      ? memories.split("\n").filter(Boolean)
      : [],
    dashboards: dashboardResult.success
      ? dashboardResult.data
      : [],
    skills: skillsResult.success
      ? skillsResult.skills
      : [],
  }

  return NextResponse.json(response)
}
