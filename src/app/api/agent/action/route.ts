import { getCurrentUser } from "@/lib/auth"
import {
  actionRegistry,
  checkActionPermission,
} from "@/lib/agent/render/action-registry"

export async function POST(
  req: Request,
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    )
  }

  const body = await req.json() as {
    action?: string
    params?: Record<string, unknown>
  }

  const { action, params } = body

  if (!action || typeof action !== "string") {
    return Response.json(
      { success: false, error: "Missing action name" },
      { status: 400 },
    )
  }

  const def = actionRegistry[action]
  if (!def) {
    return Response.json(
      {
        success: false,
        error: `Unknown action: ${action}`,
      },
      { status: 400 },
    )
  }

  if (!checkActionPermission(user, action)) {
    return Response.json(
      {
        success: false,
        error: "You don't have permission for this action",
      },
      { status: 403 },
    )
  }

  const parsed = def.schema.safeParse(params ?? {})
  if (!parsed.success) {
    const fieldErrors = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ")
    return Response.json(
      {
        success: false,
        error: `Validation failed: ${fieldErrors}`,
      },
      { status: 400 },
    )
  }

  const result = await def.execute(
    parsed.data as Record<string, unknown>,
    user.id,
  )

  return Response.json(result, {
    status: result.success ? 200 : 500,
  })
}
