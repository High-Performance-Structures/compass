import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { tradeLetters } from "@/db/schema-trade-docs"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { renderTradeLetterPdf } from "@/lib/trade-letters/server"
import { isInternalStaffRole } from "@/lib/user-roles"

/** Print preview of a letter to a trade, exactly as it goes to Foxit. */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string; readonly letterId: string }> },
): Promise<Response> {
  try {
    const user = await requireAuth()
    requirePermission(user, "budget", "read")
    if (!isInternalStaffRole(user.role)) return new Response("Letter not found.", { status: 404 })
    const { id, letterId } = await context.params
    const projectId = await resolveProjectRouteId(id)
    if (!projectId) return new Response("Letter not found.", { status: 404 })
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)
    const letter = await db
      .select()
      .from(tradeLetters)
      .where(and(eq(tradeLetters.id, letterId), eq(tradeLetters.projectId, projectId)))
      .get()
    if (!letter) return new Response("Letter not found.", { status: 404 })
    const prepared = await renderTradeLetterPdf({ db, env, letter, user })
    const fileName = `${letter.letterNumber}-${letter.vendorName}`.replace(/[^a-zA-Z0-9._-]/g, "-")
    return new Response(prepared.pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    const text = error instanceof Error ? error.message : "Could not build the letter."
    return new Response(text, { status: 500 })
  }
}
