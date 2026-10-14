import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { saveMachineLogEntry } from "@/app/actions/equipment"
import { fieldMachineLogDraftSchema } from "@/lib/field/types"

const requestSchema = z.object({
  id: z.string().uuid(),
  payload: fieldMachineLogDraftSchema,
})

/** Field Mode sends a queued machine log entry; the client ID makes retries safe. */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Complete the machine log entry before saving." }, { status: 400 })
    }
    const result = await saveMachineLogEntry(null, parsed.data.payload, parsed.data.id)
    return NextResponse.json(result.success ? { success: true, entryId: result.data.id } : result, { status: result.success ? 200 : 422 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unable to save the machine log entry." },
      { status: 500 },
    )
  }
}
