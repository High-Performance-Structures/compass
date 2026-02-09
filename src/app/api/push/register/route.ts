import { NextResponse } from "next/server"
import { getDb } from "@/lib/db-universal"
import { pushTokens } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { nanoid } from "nanoid"
import { eq, and } from "drizzle-orm"

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    )
  }

  const body: unknown = await request.json()
  if (
    !body ||
    typeof body !== "object" ||
    !("token" in body) ||
    !("platform" in body)
  ) {
    return NextResponse.json(
      { error: "Missing token or platform" },
      { status: 400 },
    )
  }

  const { token, platform } = body as {
    token: string
    platform: string
  }
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json(
      { error: "Platform must be ios or android" },
      { status: 400 },
    )
  }

  const db = await getDb()
  const now = new Date().toISOString()

  // upsert: delete existing token for this user+platform, then insert
  await db
    .delete(pushTokens)
    .where(
      and(
        eq(pushTokens.userId, user.id),
        eq(pushTokens.platform, platform),
      ),
    )

  await db.insert(pushTokens).values({
    id: nanoid(),
    userId: user.id,
    token,
    platform,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    )
  }

  const body: unknown = await request.json()
  const token =
    body &&
    typeof body === "object" &&
    "token" in body &&
    typeof (body as Record<string, unknown>).token === "string"
      ? (body as Record<string, string>).token
      : undefined

  const db = await getDb()

  if (token) {
    await db
      .delete(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, user.id),
          eq(pushTokens.token, token),
        ),
      )
  } else {
    // remove all tokens for user (sign-out)
    await db
      .delete(pushTokens)
      .where(eq(pushTokens.userId, user.id))
  }

  return NextResponse.json({ success: true })
}
