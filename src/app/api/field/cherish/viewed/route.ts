import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { markCherishStoryViewed } from "@/app/actions/cherish-stories"

const requestSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(20),
})

// Field Mode marks CHERISH stories viewed when the crew member opens them, so
// the Today spotlight only appears for something new, as on the web dashboard.
export async function POST(request: Request): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Choose the CHERISH stories to mark viewed." },
      { status: 400 },
    )
  }

  const results = await Promise.all(
    parsed.data.ids.map((id) => markCherishStoryViewed({ id })),
  )
  const failed = results.find((result) => !result.success)
  if (failed && !failed.success) {
    return NextResponse.json({ success: false, error: failed.error }, { status: 403 })
  }
  return NextResponse.json({ success: true })
}
