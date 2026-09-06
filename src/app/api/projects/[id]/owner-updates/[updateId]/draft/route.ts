import { resolveProjectRouteId } from "@/lib/project-route-id"
import {
  publishOwnerProjectUpdate,
  updateOwnerProjectUpdateDraft,
} from "@/app/actions/project-field"
import { requireAuth } from "@/lib/auth"
import { parseOwnerUpdateDraftEdit } from "@/lib/owner-updates/draft-recovery"
import { persistOwnerUpdateDraft } from "@/lib/owner-updates/draft-publish"

export async function PUT(
  request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly updateId: string
    }>
  }
): Promise<Response> {
  try {
    await requireAuth()
  } catch {
    return Response.json(
      { success: false, error: "Authentication is required." },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { success: false, error: "Invalid draft data." },
      { status: 400 }
    )
  }

  const parsed = parseOwnerUpdateDraftEdit(body)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: "The draft contains invalid data." },
      { status: 400 }
    )
  }

  const { id: rawProjectId, updateId } = await params
  const id = await resolveProjectRouteId(rawProjectId)
  if (!id) return Response.json({ success: false, error: "Project not found." }, { status: 404 })
  const intent =
    new URL(request.url).searchParams.get("intent") === "publish"
      ? "publish"
      : "save"
  const result = await persistOwnerUpdateDraft({
    intent,
    save: () =>
      updateOwnerProjectUpdateDraft(
        id,
        updateId,
        parsed.data
      ),
    publish: () => publishOwnerProjectUpdate(id, updateId),
  })

  return Response.json(result, { status: result.success ? 200 : 400 })
}
