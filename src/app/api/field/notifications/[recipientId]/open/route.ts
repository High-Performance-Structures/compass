import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/db"
import { notificationEvents, notificationRecipients } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"

async function markNotificationRead(
  recipientId: string,
  userId: string
): Promise<string | null> {
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
        eq(notificationRecipients.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!notification) return null

  await db
    .update(notificationRecipients)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notificationRecipients.id, recipientId),
        eq(notificationRecipients.userId, userId)
      )
    )
  return notification.href
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly recipientId: string }> }
): Promise<Response> {
  const user = await requireAuth()
  const { recipientId } = await params
  const href = await markNotificationRead(recipientId, user.id)
  if (!href) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  const destination = href.startsWith("/dashboard/")
    ? href
    : "/dashboard"
  return NextResponse.redirect(new URL(destination, request.url))
}

export async function POST(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly recipientId: string }> }
): Promise<Response> {
  const user = await requireAuth()
  const { recipientId } = await params
  const href = await markNotificationRead(recipientId, user.id)
  if (!href) {
    return NextResponse.json(
      { success: false, error: "Notification not found." },
      { status: 404 }
    )
  }
  return NextResponse.json({ success: true, href })
}
