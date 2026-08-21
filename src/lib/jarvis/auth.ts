const SIGNATURE_HEADER = "x-compass-signature"
const TIMESTAMP_HEADER = "x-compass-timestamp"
const MAX_CLOCK_SKEW_SECONDS = 5 * 60
export const MAX_JARVIS_BODY_BYTES = 64 * 1024

type VerificationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type JarvisBridgeSecrets = string | readonly string[]

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0
    const rightCode = index < right.length ? right.charCodeAt(index) : 0
    difference |= leftCode ^ rightCode
  }
  return difference === 0
}

function signingPayload(
  timestamp: string,
  method: string,
  target: string,
  rawBody: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${target}.${rawBody}`
}

export async function createJarvisSignature(
  secret: string,
  timestamp: string,
  method: string,
  target: string,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      signingPayload(timestamp, method, target, rawBody),
    ),
  )

  return `sha256=${bytesToHex(new Uint8Array(signature))}`
}

export async function verifyJarvisRequest(
  request: Request,
  secret: JarvisBridgeSecrets,
  rawBody: string,
  now = Date.now(),
): Promise<VerificationResult> {
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const suppliedSignature = request.headers.get(SIGNATURE_HEADER)

  if (!timestamp || !suppliedSignature) {
    return { success: false, error: "Missing bridge signature" }
  }

  const timestampSeconds = Number(timestamp)
  if (!Number.isInteger(timestampSeconds)) {
    return { success: false, error: "Invalid bridge timestamp" }
  }

  const nowSeconds = Math.floor(now / 1000)
  if (
    Math.abs(nowSeconds - timestampSeconds) >
    MAX_CLOCK_SKEW_SECONDS
  ) {
    return { success: false, error: "Expired bridge signature" }
  }

  const url = new URL(request.url)
  const target = `${url.pathname}${url.search}`
  const secrets = typeof secret === "string" ? [secret] : secret
  let signatureMatches = false
  for (const candidate of secrets) {
    const expectedSignature = await createJarvisSignature(
      candidate,
      timestamp,
      request.method,
      target,
      rawBody,
    )
    if (constantTimeEqual(expectedSignature, suppliedSignature)) {
      signatureMatches = true
    }
  }

  if (!signatureMatches) {
    return { success: false, error: "Invalid bridge signature" }
  }

  return { success: true }
}

export async function readBoundedBody(
  request: Request,
): Promise<
  | { readonly success: true; readonly rawBody: string }
  | { readonly success: false; readonly error: string }
> {
  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  )
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JARVIS_BODY_BYTES
  ) {
    return { success: false, error: "Request body is too large" }
  }

  const rawBody = await request.text()
  if (
    new TextEncoder().encode(rawBody).byteLength >
    MAX_JARVIS_BODY_BYTES
  ) {
    return { success: false, error: "Request body is too large" }
  }

  return { success: true, rawBody }
}

export function getJarvisEnvValue(
  env: CloudflareEnv,
  key: string,
): string | null {
  const value: unknown = Reflect.get(env, key)
  return typeof value === "string" && value.length > 0
    ? value
    : null
}

export function getJarvisBridgeSecrets(
  env: CloudflareEnv,
): readonly string[] | null {
  const primary = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!primary) return null

  const secondary = getJarvisEnvValue(
    env,
    "JARVIS_BRIDGE_SECONDARY_SECRET",
  )
  if (!secondary || secondary === primary) return [primary]
  return [primary, secondary]
}
