import { updateOwnerProjectUpdateDraft } from "@/app/actions/project-field"
import { ownerUpdateDraftEditSchema } from "@/lib/owner-updates/draft-recovery"

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
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { success: false, error: "Invalid draft data." },
      { status: 400 }
    )
  }

  const parsed = ownerUpdateDraftEditSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: "The draft contains invalid data." },
      { status: 400 }
    )
  }

  const { id, updateId } = await params
  const result = await updateOwnerProjectUpdateDraft(
    id,
    updateId,
    parsed.data
  )

  return Response.json(result, { status: result.success ? 200 : 400 })
}
