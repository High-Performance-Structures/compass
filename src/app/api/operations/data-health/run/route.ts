import { sendDataHealthNotices } from "@/lib/domain/data-health/notices"
import { isHealthy } from "@/lib/domain/data-health/rules"
import { dataHealthOperatorOrganizationId, runDataHealthCheck } from "@/lib/domain/data-health/run"
import { signedMaintenanceRoute } from "@/lib/server/signed-maintenance-route"

/** Scheduled daily: the read-only drift check, then a Data health notice where the drift changed. */
export async function POST(request: Request): Promise<Response> {
  return signedMaintenanceRoute(request, "Data health check failed", async (db, env) => {
    const report = await runDataHealthCheck(db)
    const notices = await sendDataHealthNotices(db, report, dataHealthOperatorOrganizationId(env))
    return { healthy: isHealthy(report), statusFindings: report.statusFindings.length, ...notices }
  })
}
