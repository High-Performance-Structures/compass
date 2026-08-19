import { NextResponse } from "next/server"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
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
    !("platform" in body) ||
    typeof body.token !== "string" ||
    typeof body.platform !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing token or platform" },
      { status: 400 },
    )
  }

  const { token, platform } = body
  if (token.length < 16 || token.length > 4096) {
    return NextResponse.json(
      { error: "Invalid push token" },
      { status: 400 },
    )
  }
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json(
      { error: "Platform must be ios or android" },
      { status: 400 },
    )
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
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
    typeof body.token === "string"
      ? body.token
      : undefined

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

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
