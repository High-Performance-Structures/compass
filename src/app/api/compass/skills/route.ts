import { getCloudflareContext } from "@opennextjs/cloudflare"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import {
  installSkill as installSkillAction,
  uninstallSkill as uninstallSkillAction,
  toggleSkill as toggleSkillAction,
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"

type SkillAction = "list" | "install" | "toggle" | "uninstall"

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

  let body: { action: SkillAction; [key: string]: unknown }
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
        const result = await getInstalledSkillsAction()
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        })
      }

      case "install": {
        if (auth.role !== "admin") {
          return new Response(
            JSON.stringify({
              error: "admin role required to install skills",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const source = body.source as string
        if (!source) {
          return new Response(
            JSON.stringify({ error: "source required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await installSkillAction(source)
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        })
      }

      case "toggle": {
        if (auth.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "admin role required" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const pluginId = body.pluginId as string
        const enabled = body.enabled as boolean
        if (!pluginId || enabled === undefined) {
          return new Response(
            JSON.stringify({
              error: "pluginId and enabled required",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await toggleSkillAction(pluginId, enabled)
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        })
      }

      case "uninstall": {
        if (auth.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "admin role required" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const pluginId = body.pluginId as string
        if (!pluginId) {
          return new Response(
            JSON.stringify({ error: "pluginId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await uninstallSkillAction(pluginId)
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        })
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
    console.error("Skills endpoint error:", error)
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
