import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { countOverdueFollowUpsForUser } from "@/lib/project-follow-up-reminders"
import { isInternalStaffRole } from "@/lib/user-roles"

export const dynamic = "force-dynamic"

/** Overdue client follow-ups the signed-in user answers for (sidebar red count). */
export async function GET(): Promise<Response> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !user.isActive || !isInternalStaffRole(user.role)) {
      return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } })
    }
    const { env } = await getCloudflareContext()
    const count = await countOverdueFollowUpsForUser(getDb(env.DB), user.organizationId, user.id)
    return Response.json({ count }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } })
  }
}
