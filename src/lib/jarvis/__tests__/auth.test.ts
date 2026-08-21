import { describe, expect, it } from "vitest"
import {
  createJarvisSignature,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"

const SECRET = "test-bridge-secret"
const SECONDARY_SECRET = "test-secondary-bridge-secret"
const NOW = 1_800_000_000_000
const TIMESTAMP = String(Math.floor(NOW / 1000))

async function signedRequest(
  body: string,
  timestamp = TIMESTAMP,
  secret = SECRET,
): Promise<Request> {
  const target = "/api/integrations/jarvis/events?limit=10"
  const signature = await createJarvisSignature(
    secret,
    timestamp,
    "POST",
    target,
    body,
  )

  return new Request(`https://compass.example${target}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-compass-timestamp": timestamp,
      "x-compass-signature": signature,
    },
    body,
  })
}

describe("Jarvis bridge authentication", () => {
  it("accepts a request signed with the primary secret", async () => {
    const body = JSON.stringify({ source: "telegram" })
    const request = await signedRequest(body)

    await expect(
      verifyJarvisRequest(request, SECRET, body, NOW),
    ).resolves.toEqual({ success: true })
  })

  it("accepts a request signed with the secondary secret", async () => {
    const body = JSON.stringify({ source: "telegram" })
    const request = await signedRequest(body, TIMESTAMP, SECONDARY_SECRET)

    await expect(
      verifyJarvisRequest(
        request,
        [SECRET, SECONDARY_SECRET],
        body,
        NOW,
      ),
    ).resolves.toEqual({ success: true })
  })

  it("rejects a request signed with an unconfigured secret", async () => {
    const body = JSON.stringify({ source: "telegram" })
    const request = await signedRequest(body, TIMESTAMP, "invalid-secret")

    await expect(
      verifyJarvisRequest(request, [SECRET, SECONDARY_SECRET], body, NOW),
    ).resolves.toEqual({
      success: false,
      error: "Invalid bridge signature",
    })
  })

  it("rejects a modified request body", async () => {
    const request = await signedRequest('{"source":"telegram"}')

    await expect(
      verifyJarvisRequest(
        request,
        SECRET,
        '{"source":"jarvis-email"}',
        NOW,
      ),
    ).resolves.toEqual({
      success: false,
      error: "Invalid bridge signature",
    })
  })

  it("rejects expired signatures", async () => {
    const oldTimestamp = String(
      Math.floor((NOW - 6 * 60 * 1000) / 1000),
    )
    const body = "{}"
    const request = await signedRequest(body, oldTimestamp)

    await expect(
      verifyJarvisRequest(request, SECRET, body, NOW),
    ).resolves.toEqual({
      success: false,
      error: "Expired bridge signature",
    })
  })

  it("rejects bodies larger than the bridge limit", async () => {
    const request = new Request("https://compass.example/events", {
      method: "POST",
      body: "x".repeat(65 * 1024),
    })

    await expect(readBoundedBody(request)).resolves.toEqual({
      success: false,
      error: "Request body is too large",
    })
  })
})
