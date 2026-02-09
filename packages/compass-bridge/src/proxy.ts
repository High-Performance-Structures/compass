// HTTP proxy server that captures Claude Code auth
// and forwards API requests to Anthropic

export const PROXY_PORT = 18790

export interface CapturedAuth {
  readonly fullHeaders: Headers
  readonly capturedAt: number
}

let capturedAuth: CapturedAuth | null = null

export function getCapturedAuth(): CapturedAuth | null {
  return capturedAuth
}

export function startProxy(port: number): void {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)

      // detect auth headers
      const apiKey = req.headers.get("x-api-key")
      const authHeader = req.headers.get("authorization")
      const hasAuth = !!(apiKey || authHeader)

      // detect bridge vs Claude Code request
      const isBridgeRequest =
        req.headers.get("x-compass-bridge") === "true"

      // build forward request to api.anthropic.com
      const targetUrl = new URL(
        url.pathname + url.search,
        "https://api.anthropic.com",
      )

      let forwardHeaders: Headers

      if (!isBridgeRequest && hasAuth) {
        // from Claude Code: capture headers and
        // passthrough
        capturedAuth = {
          fullHeaders: new Headers(req.headers),
          capturedAt: Date.now(),
        }
        console.log(
          "[proxy] auth captured from Claude Code request"
        )
        forwardHeaders = new Headers(req.headers)
      } else if (isBridgeRequest && capturedAuth) {
        // from bridge: inject captured Claude Code
        // headers
        forwardHeaders = new Headers(
          capturedAuth.fullHeaders
        )
        // keep content-length and content-type from
        // actual request (body size/type differs)
        const cl = req.headers.get("content-length")
        if (cl) forwardHeaders.set("content-length", cl)
        const ct = req.headers.get("content-type")
        if (ct) forwardHeaders.set("content-type", ct)
        // strip bridge marker before forwarding
        forwardHeaders.delete("x-compass-bridge")
        console.log(
          "[proxy] injecting Claude Code headers for " +
            "bridge request"
        )
      } else {
        // no captured auth, forward as-is
        forwardHeaders = new Headers(req.headers)
      }

      // update Host header to match target
      forwardHeaders.set("host", "api.anthropic.com")

      // forward request
      const forwardReq = new Request(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body:
          req.method !== "GET" && req.method !== "HEAD"
            ? req.body
            : undefined,
      })

      const res = await fetch(forwardReq)

      // strip compression headers (bun auto-decompressed)
      const responseHeaders = new Headers(res.headers)
      responseHeaders.delete("content-encoding")
      responseHeaders.delete("content-length")
      responseHeaders.delete("transfer-encoding")

      // handle streaming responses (SSE)
      const contentType = res.headers.get("content-type")
      const isStream = contentType?.includes(
        "text/event-stream",
      )

      if (isStream && res.body) {
        // passthrough stream without buffering
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders,
        })
      }

      // for non-streaming, just return the response
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      })
    },
  })

  console.log(
    `[bridge] proxy listening on http://127.0.0.1:${server.port}`,
  )
  console.log(
    "[bridge] set ANTHROPIC_BASE_URL=http://localhost:" +
      `${server.port} when running Claude Code`,
  )
}
