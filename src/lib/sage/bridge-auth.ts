const SIGNATURE_HEADER = "x-compass-signature"
const TIMESTAMP_HEADER = "x-compass-timestamp"
export const SAGE_BRIDGE_REQUEST_ID_HEADER = "x-compass-request-id"
const MAX_CLOCK_SKEW_SECONDS = 5 * 60
export const MAX_SAGE_BRIDGE_BODY_BYTES = 1024 * 1024

type VerificationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function signingPayload(
  timestamp: string,
  requestId: string,
  method: string,
  target: string,
  rawBody: string
): string {
  return `${timestamp}.${requestId}.${method.toUpperCase()}.${target}.${rawBody}`
}

export async function createSageBridgeSignature(
  secret: string,
  timestamp: string,
  requestId: string,
  method: string,
  target: string,
  rawBody: string
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      signingPayload(timestamp, requestId, method, target, rawBody)
    )
  )
  return `sha256=${bytesToHex(new Uint8Array(signature))}`
}

export async function verifySageBridgeRequest(
  request: Request,
  secret: string,
  rawBody: string,
  now = Date.now()
): Promise<VerificationResult> {
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  const suppliedSignature = request.headers.get(SIGNATURE_HEADER)
  if (!timestamp || !requestId || !suppliedSignature) {
    return { success: false, error: "Missing bridge signature" }
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId
    )
  ) {
    return { success: false, error: "Invalid bridge request ID" }
  }
  const timestampSeconds = Number(timestamp)
  if (!Number.isInteger(timestampSeconds)) {
    return { success: false, error: "Invalid bridge timestamp" }
  }
  if (
    Math.abs(Math.floor(now / 1000) - timestampSeconds) >
    MAX_CLOCK_SKEW_SECONDS
  ) {
    return { success: false, error: "Expired bridge signature" }
  }

  const url = new URL(request.url)
  const expected = await createSageBridgeSignature(
    secret,
    timestamp,
    requestId,
    request.method,
    `${url.pathname}${url.search}`,
    rawBody
  )
  return constantTimeEqual(expected, suppliedSignature)
    ? { success: true }
    : { success: false, error: "Invalid bridge signature" }
}

export async function readBoundedSageBridgeBody(
  request: Request
): Promise<
  | { readonly success: true; readonly rawBody: string }
  | { readonly success: false; readonly error: string }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SAGE_BRIDGE_BODY_BYTES
  ) {
    return { success: false, error: "Request body is too large" }
  }
  if (!request.body) return { success: true, rawBody: "" }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let totalBytes = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    totalBytes += next.value.byteLength
    if (totalBytes > MAX_SAGE_BRIDGE_BODY_BYTES) {
      await reader.cancel()
      return { success: false, error: "Request body is too large" }
    }
    parts.push(decoder.decode(next.value, { stream: true }))
  }
  parts.push(decoder.decode())
  return { success: true, rawBody: parts.join("") }
}

export function getSageBridgeSecret(env: CloudflareEnv): string | null {
  const value: unknown = Reflect.get(env, "SAGE_BRIDGE_SECRET")
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length >= 32 ? trimmed : null
}
