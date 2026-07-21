import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/db"
import { notificationEvents, notificationRecipients } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly recipientId: string }> }
): Promise<Response> {
  const user = await requireAuth()
  const { recipientId } = await params
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const notification = await db
    .select({ href: notificationEvents.href })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId)
    )
    .where(
      and(
        eq(notificationRecipients.id, recipientId),
        eq(notificationRecipients.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!notification) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  await db
    .update(notificationRecipients)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notificationRecipients.id, recipientId),
        eq(notificationRecipients.userId, user.id)
      )
    )

  const destination = notification.href.startsWith("/dashboard/")
    ? notification.href
    : "/dashboard"
  return NextResponse.redirect(new URL(destination, request.url))
}
