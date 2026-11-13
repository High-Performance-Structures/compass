import { dataHealthReportResponse } from "@/lib/domain/data-health/report-response"

/** The drift report as JSON, for the daily regression smoke run and company admins. Read-only. */
export async function GET(request: Request): Promise<Response> {
  return dataHealthReportResponse(request)
}
