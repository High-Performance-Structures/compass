import { getMyStaleMessageCount } from "@/app/actions/staff-message-desk"
import { countReviewableHeldJobEmails } from "@/app/actions/inbound-email-review"

export const dynamic = "force-dynamic"

/**
 * What needs the signed-in user on the Message Desk: stale messages assigned
 * to them, plus held job emails for those who review them. A plain GET (not
 * a server action) so the sidebar's refresh never holds up page navigation.
 */
export async function GET(): Promise<Response> {
  const [stale, held] = await Promise.all([getMyStaleMessageCount(), countReviewableHeldJobEmails()])
  return Response.json({ count: stale + held, stale, held }, { headers: { "Cache-Control": "no-store" } })
}
