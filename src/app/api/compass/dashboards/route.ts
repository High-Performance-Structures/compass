import { validateAgentAuth } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { resolveAgentUser } from "@/lib/agent/agent-user"
import {
  deleteCustomDashboardForUser,
  getCustomDashboardForUser,
  listCustomDashboardsForUser,
} from "@/lib/dashboards/user-dashboards"
import { revalidatePath } from "next/cache"

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

  // The agent calls this route with a bearer token only, so the user comes
  // from the verified token rather than the (absent) session cookie.
  const db = getDb(env.DB)
  const user = await resolveAgentUser(db, auth)
  if (!user) {
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
        const dashboards = await listCustomDashboardsForUser(db, user.id)
        return new Response(
          JSON.stringify({
            dashboards,
            count: dashboards.length,
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

        const result = await getCustomDashboardForUser(
          db,
          user.id,
          dashboardId,
        )
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

        const result = await deleteCustomDashboardForUser(
          db,
          user.id,
          dashboardId,
        )
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
        revalidatePath("/", "layout")

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
