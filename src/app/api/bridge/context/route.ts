import { NextRequest, NextResponse } from "next/server"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { validateApiKey } from "@/lib/mcp/auth"
import { loadMemoriesForPrompt } from "@/lib/agent/memory"
import {
  getCustomDashboards,
} from "@/app/actions/dashboards"
import {
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"
import type { BridgeContextResponse } from "@/lib/mcp/types"

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

export async function GET(
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

  const authResult = await validateApiKey(db, token)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401 },
    )
  }

  const [memories, dashboardResult, skillsResult] =
    await Promise.all([
      loadMemoriesForPrompt(db, authResult.userId),
      getCustomDashboards(),
      getInstalledSkillsAction(),
    ])

  const response: BridgeContextResponse = {
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
