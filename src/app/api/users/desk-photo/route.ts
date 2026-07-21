import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { userDeskPhotos } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"

const MAX_DESK_PHOTO_BYTES = 1_500_000
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

type DeskPhotoMetadata =
  | { readonly state: "default" }
  | { readonly state: "hidden"; readonly updatedAt: string }
  | { readonly state: "custom"; readonly updatedAt: string }

function jsonResponse(value: DeskPhotoMetadata, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { success: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 32_768

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize)
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0)
    }
  }

  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const wantsMetadata = request.nextUrl.searchParams.get("metadata") === "1"

    const [photo] = await db
      .select({
        mimeType: userDeskPhotos.mimeType,
        imageDataBase64: userDeskPhotos.imageDataBase64,
        hidden: userDeskPhotos.hidden,
        updatedAt: userDeskPhotos.updatedAt,
      })
      .from(userDeskPhotos)
      .where(eq(userDeskPhotos.userId, user.id))
      .limit(1)

    if (!photo) return wantsMetadata ? jsonResponse({ state: "default" }) : new Response(null, { status: 404 })
    if (photo.hidden) {
      return wantsMetadata
        ? jsonResponse({ state: "hidden", updatedAt: photo.updatedAt })
        : new Response(null, { status: 404 })
    }
    if (!photo.mimeType || !photo.imageDataBase64) {
      return wantsMetadata ? jsonResponse({ state: "default" }) : new Response(null, { status: 404 })
    }
    if (wantsMetadata) {
      return jsonResponse({ state: "custom", updatedAt: photo.updatedAt })
    }

    const etag = `W/"${photo.updatedAt}"`
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }

    return new Response(decodeBase64(photo.imageDataBase64), {
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Type": photo.mimeType,
        ETag: etag,
      },
    })
  } catch (error: unknown) {
    console.error("Failed to load desk photo", error)
    return errorResponse("Unable to load the desk photo.", 401)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return errorResponse("Desk photos cannot be changed in demo mode.", 403)
    }

    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!photo || typeof photo === "string") {
      return errorResponse("Choose an image to upload.", 400)
    }
    if (!ALLOWED_IMAGE_TYPES.has(photo.type)) {
      return errorResponse("Use a JPEG, PNG, or WebP image.", 400)
    }
    if (photo.size < 1 || photo.size > MAX_DESK_PHOTO_BYTES) {
      return errorResponse("The resized desk photo must be smaller than 1.5 MB.", 400)
    }

    const updatedAt = new Date().toISOString()
    const imageDataBase64 = encodeBase64(await photo.arrayBuffer())
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .insert(userDeskPhotos)
      .values({
        userId: user.id,
        mimeType: photo.type,
        imageDataBase64,
        hidden: false,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: userDeskPhotos.userId,
        set: {
          mimeType: photo.type,
          imageDataBase64,
          hidden: false,
          updatedAt,
        },
      })

    return jsonResponse({ state: "custom", updatedAt })
  } catch (error: unknown) {
    console.error("Failed to save desk photo", error)
    return errorResponse("Unable to save the desk photo.", 500)
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return errorResponse("Desk photos cannot be changed in demo mode.", 403)
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const mode = request.nextUrl.searchParams.get("mode")

    if (mode === "reset") {
      await db.delete(userDeskPhotos).where(eq(userDeskPhotos.userId, user.id))
      return jsonResponse({ state: "default" })
    }

    const updatedAt = new Date().toISOString()
    await db
      .insert(userDeskPhotos)
      .values({
        userId: user.id,
        mimeType: null,
        imageDataBase64: null,
        hidden: true,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: userDeskPhotos.userId,
        set: {
          mimeType: null,
          imageDataBase64: null,
          hidden: true,
          updatedAt,
        },
      })

    return jsonResponse({ state: "hidden", updatedAt })
  } catch (error: unknown) {
    console.error("Failed to update desk photo", error)
    return errorResponse("Unable to update the desk photo.", 500)
  }
}
