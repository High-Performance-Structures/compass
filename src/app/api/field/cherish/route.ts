import { NextResponse } from "next/server"
import { z } from "zod/v4"

import {
  getCherishPulseTeamStream,
  submitCherishPulseResponse,
} from "@/app/actions/cherish-pulse"
import { toFieldCherishRecognitions } from "@/lib/field/cherish-recognition"
import {
  cherishResponseTypeSchema,
  cherishValueSchema,
} from "@/lib/field/types"

const requestSchema = z.object({
  id: z.string().uuid(),
  cherishValue: cherishValueSchema,
  responseType: cherishResponseTypeSchema,
  message: z.string().trim().min(3).max(1_200),
  anonymous: z.boolean().default(false),
})

export async function GET(): Promise<Response> {
  try {
    const result = await getCherishPulseTeamStream()
    if (!result.success) {
      return NextResponse.json(result, { status: 403 })
    }

    return NextResponse.json(
      {
        success: true,
        items: toFieldCherishRecognitions(result.data),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load CHERISH recognition.",
      },
      { status: 500 },
    )
  }
}

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
      anonymous: parsed.data.anonymous,
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
