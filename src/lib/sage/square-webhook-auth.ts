export const SQUARE_WEBHOOK_NOTIFICATION_URL =
  "https://compass.openrangeconstruction.ltd/api/integrations/square/webhook"

const MAX_SQUARE_WEBHOOK_BODY_BYTES = 512 * 1024

function envString(env: object, name: string): string | null {
  const value: unknown = Reflect.get(env, name)
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function sageSquareWebhookEnabled(env: object): boolean {
  return (
    envString(env, "SAGE_SQUARE_PAYMENT_WEBHOOK_ENABLED")?.toLowerCase() ===
    "true"
  )
}

export function getSquareWebhookSignatureKey(env: object): string | null {
  const value = envString(env, "SQUARE_WEBHOOK_SIGNATURE_KEY")
  return value && value.length >= 16 ? value : null
}

function decodeBase64(value: string): ArrayBuffer | null {
  try {
    const decoded = atob(value)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index)
    }
    return bytes.buffer
  } catch {
    return null
  }
}

export async function verifySquareWebhookSignature(
  rawBody: string,
  suppliedSignature: string,
  signatureKey: string,
  notificationUrl = SQUARE_WEBHOOK_NOTIFICATION_URL
): Promise<boolean> {
  const signature = decodeBase64(suppliedSignature)
  if (!signature) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(`${notificationUrl}${rawBody}`)
  )
}

export async function readBoundedSquareWebhookBody(
  request: Request
): Promise<
  | { readonly success: true; readonly rawBody: string }
  | { readonly success: false; readonly error: string }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SQUARE_WEBHOOK_BODY_BYTES
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
    if (totalBytes > MAX_SQUARE_WEBHOOK_BODY_BYTES) {
      await reader.cancel()
      return { success: false, error: "Request body is too large" }
    }
    parts.push(decoder.decode(next.value, { stream: true }))
  }
  parts.push(decoder.decode())
  return { success: true, rawBody: parts.join("") }
}
