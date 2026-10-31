import { NextResponse } from "next/server"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { nanoid } from "nanoid"
import { deleteUserPushTokens, registerPushToken } from "@/lib/domain/settings/store"

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

  // The delete-then-insert stays one batch (see registerPushToken).
  await registerPushToken(db, { id: nanoid(), userId: user.id, token, platform, now })

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

  // Without a token, remove all tokens for the user (sign-out).
  await deleteUserPushTokens(db, user.id, token ?? null)

  return NextResponse.json({ success: true })
}
