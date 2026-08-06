import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  listGoogleAuthOrganizationIds,
  syncGmailInboundReplies,
} from "@/lib/email/gmail-inbound"
import { requireOrg } from "@/lib/org-scope"
import { can } from "@/lib/permissions"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

async function requestedOrganizationIds(input: {
  readonly request: NextRequest
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
}): Promise<
  | { readonly success: true; readonly organizationIds: readonly string[] }
  | { readonly success: false; readonly status: number; readonly error: string }
> {
  const configuredSecret = envString(input.env, "COMPASS_EMAIL_SYNC_SECRET")
  const requestSecret =
    bearerToken(input.request) ?? input.request.headers.get("x-compass-sync-secret")

  if (
    configuredSecret &&
    requestSecret &&
    requestSecret === configuredSecret
  ) {
    const organizationIds = await listGoogleAuthOrganizationIds({ db: input.db })
    return { success: true, organizationIds }
  }

  const user = await getCurrentUser()
  if (!user) {
    return { success: false, status: 401, error: "Unauthorized" }
  }
  if (!can(user, "channels", "moderate")) {
    return { success: false, status: 403, error: "Forbidden" }
  }

  return { success: true, organizationIds: [requireOrg(user)] }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const orgs = await requestedOrganizationIds({ request, env, db })
  if (!orgs.success) {
    return NextResponse.json({ success: false, error: orgs.error }, { status: orgs.status })
  }

  const summaries = []
  for (const organizationId of orgs.organizationIds) {
    const summary = await syncGmailInboundReplies({
      env,
      db,
      organizationId,
    })
    summaries.push({ organizationId, ...summary })
  }

  console.log(
    "[gmail-sync]",
    JSON.stringify(
      summaries.map((summary) => ({
        organizationId: summary.organizationId,
        scanned: summary.scanned,
        imported: summary.imported,
        posted: summary.posted,
        needsReview: summary.needsReview,
        errors: summary.errors,
      }))
    )
  )

  return NextResponse.json({ success: true, summaries })
}
