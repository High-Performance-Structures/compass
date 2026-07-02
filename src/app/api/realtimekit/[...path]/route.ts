import { getCurrentUser } from "@/lib/auth"

const REALTIMEKIT_API_ORIGIN = "https://api.realtime.cloudflare.com"
const FORWARDED_REQUEST_HEADERS = ["authorization", "content-type"] as const
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control"] as const

type RouteContext = {
  readonly params: Promise<{
    readonly path: readonly string[]
  }>
}

function upstreamUrl(request: Request, path: readonly string[]): string | null {
  if (path.length === 0) return null
  const safePath = path.map((part) => encodeURIComponent(part)).join("/")
  const requestUrl = new URL(request.url)
  const url = new URL(`/${safePath}`, REALTIMEKIT_API_ORIGIN)
  url.search = requestUrl.search
  return url.toString()
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers()
  for (const key of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }
  return headers
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers()
  for (const key of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(key)
    if (value) headers.set(key, value)
  }
  return headers
}

function isOptionalActiveTranscriptRequest(
  method: string,
  path: readonly string[]
): boolean {
  return (
    method === "GET" &&
    path.length === 4 &&
    path[0] === "v2" &&
    path[1] === "meetings" &&
    path[3] === "active-transcript"
  )
}

function emptyActiveTranscriptResponse(): Response {
  return Response.json({
    success: true,
    data: {
      transcript: [],
      transcriptions: [],
    },
  })
}

async function realtimeKitProxy(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { path } = await context.params
  const url = upstreamUrl(request, path)
  if (!url) {
    return Response.json({ error: "Missing RealtimeKit path" }, { status: 400 })
  }

  const method = request.method.toUpperCase()
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer()

  const upstream = await fetch(url, {
    method,
    headers: requestHeaders(request),
    body,
  })

  if (!upstream.ok && isOptionalActiveTranscriptRequest(method, path)) {
    return emptyActiveTranscriptResponse()
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  })
}

export function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return realtimeKitProxy(request, context)
}

export function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return realtimeKitProxy(request, context)
}

export function PUT(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return realtimeKitProxy(request, context)
}

export function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return realtimeKitProxy(request, context)
}

export function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return realtimeKitProxy(request, context)
}
