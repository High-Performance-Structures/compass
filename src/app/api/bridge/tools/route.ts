import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { mcpUsage } from "@/db/schema-mcp"
import {
  validateApiKey,
  checkRateLimit,
} from "@/lib/mcp/auth"
import { executeBridgeTool } from "@/lib/mcp/tool-adapter"
import type { BridgeToolRequest } from "@/lib/mcp/types"

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

  const authResult = await validateApiKey(db, token)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401 },
    )
  }

  const withinLimit = await checkRateLimit(
    db,
    authResult.keyId,
  )
  if (!withinLimit) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429 },
    )
  }

  let body: BridgeToolRequest
  try {
    body = (await req.json()) as BridgeToolRequest
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    )
  }

  if (
    typeof body.tool !== "string" ||
    typeof body.args !== "object" ||
    body.args === null
  ) {
    return NextResponse.json(
      {
        error:
          "body must include tool (string) " +
          "and args (object)",
      },
      { status: 400 },
    )
  }

  // look up user role
  const userRow = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, authResult.userId))
    .get()

  const userRole = userRow?.role ?? "office"

  const startMs = Date.now()
  const result = await executeBridgeTool(
    body.tool,
    authResult.userId,
    userRole,
    body.args,
    authResult.scopes,
  )
  const durationMs = Date.now() - startMs

  // log usage (fire-and-forget)
  db.insert(mcpUsage)
    .values({
      id: crypto.randomUUID(),
      apiKeyId: authResult.keyId,
      userId: authResult.userId,
      toolName: body.tool,
      success: result.success,
      errorMessage: result.success
        ? null
        : result.error,
      durationMs,
      createdAt: new Date().toISOString(),
    })
    .run()
    .catch(() => {
      // non-critical: best-effort usage logging
    })

  return NextResponse.json(result)
}
