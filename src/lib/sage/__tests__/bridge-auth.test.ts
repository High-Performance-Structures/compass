import { describe, expect, it } from "vitest"

import {
  createSageBridgeSignature,
  MAX_SAGE_BRIDGE_BODY_BYTES,
  readBoundedSageBridgeBody,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"

const SECRET = "test-sage-bridge-secret-with-32-characters"
const REQUEST_ID = "8cae3eb4-757d-419d-9f88-21719ac08e1d"

async function signedRequest(
  timestamp: string,
  body: string
): Promise<Request> {
  const target = "/api/integrations/sage/pay-applications/results"
  const signature = await createSageBridgeSignature(
    SECRET,
    timestamp,
    REQUEST_ID,
    "POST",
    target,
    body
  )
  return new Request(`https://compass.example${target}`, {
    method: "POST",
    headers: {
      "x-compass-timestamp": timestamp,
      "x-compass-request-id": REQUEST_ID,
      "x-compass-signature": signature,
    },
    body,
  })
}

describe("Sage bridge HMAC authentication", () => {
  it("accepts a current signature bound to method, target, and body", async () => {
    const now = Date.parse("2026-07-30T20:00:00.000Z")
    const timestamp = String(Math.floor(now / 1000))
    const request = await signedRequest(timestamp, '{"runId":"one"}')
    await expect(
      verifySageBridgeRequest(request, SECRET, '{"runId":"one"}', now)
    ).resolves.toEqual({ success: true })
  })

  it("rejects tampered and expired requests", async () => {
    const now = Date.parse("2026-07-30T20:00:00.000Z")
    const timestamp = String(Math.floor(now / 1000))
    const request = await signedRequest(timestamp, '{"runId":"one"}')
    await expect(
      verifySageBridgeRequest(request, SECRET, '{"runId":"two"}', now)
    ).resolves.toEqual({
      success: false,
      error: "Invalid bridge signature",
    })
    await expect(
      verifySageBridgeRequest(
        request,
        SECRET,
        '{"runId":"one"}',
        now + 6 * 60 * 1000
      )
    ).resolves.toEqual({
      success: false,
      error: "Expired bridge signature",
    })
  })

  it("rejects a missing or invalid signed request ID", async () => {
    const now = Date.parse("2026-07-30T20:00:00.000Z")
    const timestamp = String(Math.floor(now / 1000))
    const request = await signedRequest(timestamp, "{}")
    request.headers.delete("x-compass-request-id")
    await expect(
      verifySageBridgeRequest(request, SECRET, "{}", now)
    ).resolves.toEqual({
      success: false,
      error: "Missing bridge signature",
    })
  })

  it("stops reading a streamed body at the byte limit", async () => {
    const chunk = new Uint8Array(MAX_SAGE_BRIDGE_BODY_BYTES / 2 + 1)
    const request = new Request("https://compass.example/results", {
      method: "POST",
    })
    Object.defineProperty(request, "body", {
      value: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk)
          controller.enqueue(chunk)
          controller.close()
        },
      }),
      configurable: true,
    })
    await expect(readBoundedSageBridgeBody(request)).resolves.toEqual({
      success: false,
      error: "Request body is too large",
    })
  })
})
