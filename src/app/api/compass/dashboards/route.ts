import { validateAgentAuth } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@/lib/db"
import {
  getCustomDashboards,
  getCustomDashboardById,
  deleteCustomDashboard,
} from "@/app/actions/dashboards"

type DashboardAction = "list" | "get" | "delete"

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: { action: DashboardAction; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    switch (body.action) {
      case "list": {
        const result = await getCustomDashboards()
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
        return new Response(
          JSON.stringify({
            dashboards: result.data,
            count: result.data.length,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "get": {
        const dashboardId = body.dashboardId as string
        if (!dashboardId) {
          return new Response(
            JSON.stringify({ error: "dashboardId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await getCustomDashboardById(dashboardId)
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        return new Response(
          JSON.stringify({
            dashboard: result.data,
            spec: JSON.parse(result.data.specData),
            queries: result.data.queries,
            renderPrompt: result.data.renderPrompt,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "delete": {
        const dashboardId = body.dashboardId as string
        if (!dashboardId) {
          return new Response(
            JSON.stringify({ error: "dashboardId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await deleteCustomDashboard(dashboardId)
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Dashboard deleted",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("Dashboards endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
