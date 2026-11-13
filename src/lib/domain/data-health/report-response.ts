/**
 * GET /api/operations/data-health/report (issue #1329): the drift report as
 * JSON, so the daily regression smoke run fails while production has drift.
 * Read-only: it runs the check and sends no notice.
 *
 * Who may ask:
 *   - a caller with `Authorization: Bearer <DATA_HEALTH_REPORT_SECRET>` (the
 *     smoke run) gets the whole deployment's report, merged across companies;
 *   - a signed-in company administrator gets their company's part.
 */
import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import { constantTimeSecretMatch } from "@/lib/goto/webhook-security"
import { orgContext } from "@/lib/server/action-context"
import { envString } from "@/lib/shared/env"
import { isAdminRole } from "@/lib/user-roles"

import { findingsByValue, isHealthy, reportForOrganization, type DataHealthReport } from "./rules"
import { runDataHealthCheck } from "./run"

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")
  return match ? match[1].trim() : null
}

function reportBody(report: DataHealthReport, mergeCompanies: boolean): Readonly<Record<string, unknown>> {
  return {
    ok: isHealthy(report),
    checkedAt: report.checkedAt,
    statusChecks: report.statusChecks,
    statusFindings: mergeCompanies ? findingsByValue(report.statusFindings) : report.statusFindings,
    schema: report.schema,
  }
}

const NO_STORE = { "Cache-Control": "no-store" }

export async function dataHealthReportResponse(request: Request): Promise<Response> {
  try {
    return await respond(request)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Data health check failed" },
      { status: 500, headers: NO_STORE },
    )
  }
}

async function respond(request: Request): Promise<Response> {
  const supplied = bearerToken(request)
  if (supplied !== null) {
    const { env } = await getCloudflareContext()
    const secret = envString(env, "DATA_HEALTH_REPORT_SECRET")
    if (!secret) return Response.json({ error: "Data health reporting is not configured" }, { status: 503, headers: NO_STORE })
    if (!constantTimeSecretMatch(secret, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE })
    const report = await runDataHealthCheck(getDb(env.DB))
    return Response.json(reportBody(report, true), { headers: NO_STORE })
  }

  const context = await orgContext()
  if (!context.success) return Response.json({ error: context.error }, { status: 401, headers: NO_STORE })
  if (!isAdminRole(context.data.user.role)) return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE })
  const report = reportForOrganization(await runDataHealthCheck(context.data.db), context.data.organizationId)
  return Response.json(reportBody(report, false), { headers: NO_STORE })
}
