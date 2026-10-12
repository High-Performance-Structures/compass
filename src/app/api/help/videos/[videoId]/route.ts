import { type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"
import { getHelpVideo } from "@/lib/help/videos"

function notFound(): Response {
  // Unknown and forbidden videos look the same, so staff-only workflows
  // can't be discovered by guessing IDs.
  return new Response("Video not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { readonly params: Promise<{ readonly videoId: string }> }
): Promise<Response> {
  const { videoId } = await params
  const video = getHelpVideo(videoId)
  if (!video) return notFound()

  const user = await getCurrentUser()
  const access = await getEffectiveHelpGuideAccess(user)
  if (!access.canViewHelp || !access.allowedGuideIds.includes(video.guideId)) {
    return notFound()
  }

  const { env } = await getCloudflareContext()
  const bucket = env.HELP_VIDEOS
  if (!bucket) return notFound()

  const object = await bucket.get(`${video.id}.mp4`, { range: request.headers })
  if (!object || !("body" in object)) return notFound()

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    ETag: object.httpEtag,
  })
  const range = object.range
  if (request.headers.has("range") && range && "offset" in range) {
    const offset = range.offset ?? 0
    const length = range.length ?? object.size - offset
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set("Content-Length", String(length))
    return new Response(object.body, { status: 206, headers })
  }
  headers.set("Content-Length", String(object.size))
  return new Response(object.body, { status: 200, headers })
}
