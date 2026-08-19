import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { submitFieldDailyLog } from "@/app/actions/field-mode"
import { fieldDailyLogDraftSchema } from "@/lib/field/types"

const requestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  payload: fieldDailyLogDraftSchema,
})

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Complete the daily log before saving." },
        { status: 400 }
      )
    }

    const result = await submitFieldDailyLog(
      parsed.data.projectId,
      parsed.data.payload,
      parsed.data.id
    )
    return NextResponse.json(result, { status: result.success ? 200 : 403 })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unable to save the daily log.",
      },
      { status: 500 }
    )
  }
}
