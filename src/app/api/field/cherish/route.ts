import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { submitCherishPulseResponse } from "@/app/actions/cherish-pulse"
import {
  cherishResponseTypeSchema,
  cherishValueSchema,
} from "@/lib/field/types"

const requestSchema = z.object({
  id: z.string().uuid(),
  cherishValue: cherishValueSchema,
  responseType: cherishResponseTypeSchema,
  message: z.string().trim().min(3).max(1_200),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Complete the CHERISH response before saving." },
        { status: 400 }
      )
    }

    const result = await submitCherishPulseResponse({
      cherishValue: parsed.data.cherishValue,
      responseType: parsed.data.responseType,
      message: parsed.data.message,
      source: "compass_mobile",
      clientSubmissionId: parsed.data.id,
    })

    return NextResponse.json(result, { status: result.success ? 200 : 403 })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the CHERISH response.",
      },
      { status: 500 }
    )
  }
}
