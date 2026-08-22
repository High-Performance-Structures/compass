import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createFoxitPreparedEnvelope,
  verifyFoxitWebhook,
} from "@/lib/foxit/esign"

afterEach(() => vi.restoreAllMocks())

describe("Foxit estimate envelopes", () => {
  it("creates an unsent embedded-preparation envelope with every signer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        folder: { folderId: 42 },
        embeddedSessionURL: "https://foxit.example/embedded/prepare",
      })
    )
    const result = await createFoxitPreparedEnvelope({
      clientId: "client-id",
      clientSecret: "client-secret",
      folderName: "EST-1 version 2",
      pdfBase64: "cGRm",
      parties: [
        { name: "Alex Owner", email: "alex@example.com", sequence: 1 },
        { name: "Sam Owner", email: "sam@example.com", sequence: 2 },
        { name: "Jordan Builder", email: "jordan@example.com", sequence: 3 },
      ],
      fields: [
        {
          type: "initial",
          x: 430,
          y: 758,
          width: 34,
          height: 18,
          documentNumber: 1,
          pageNumber: 1,
          tabOrder: 1,
          party: 1,
          partyResponsible: 1,
          name: "Page 1 initials - Client 1",
          tooltip: "Client 1: initial page 1",
          required: true,
        },
      ],
      successUrl: "https://compass.example/sent",
      errorUrl: "https://compass.example/error",
      estimateId: "estimate-1",
      sourceHash: "source-hash",
    })

    expect(result).toEqual({
      envelopeId: "42",
      embeddedSessionUrl: "https://foxit.example/embedded/prepare",
    })
    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toContain("/folders/createfolder")
    const options = request?.[1]
    const body = typeof options?.body === "string" ? JSON.parse(options.body) : null
    expect(body).toMatchObject({
      sendNow: false,
      createEmbeddedSendingSession: true,
      fixDocuments: true,
      fixRecipientParties: true,
      metadata: {
        compassEstimateId: "estimate-1",
        compassSourceHash: "source-hash",
      },
    })
    expect(body?.parties).toHaveLength(3)
    expect(body?.fields).toEqual([
      expect.objectContaining({ type: "initial", party: 1, required: true }),
    ])
  })

  it("verifies Foxit HMAC signatures against the untouched request body", async () => {
    const body = new TextEncoder().encode('{"event_name":"folder_executed"}')
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("webhook-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body))
    let binary = ""
    for (const byte of digest) binary += String.fromCharCode(byte)
    const signature = btoa(binary)

    await expect(
      verifyFoxitWebhook({ secret: "webhook-secret", body, signature })
    ).resolves.toBe(true)
    await expect(
      verifyFoxitWebhook({ secret: "wrong-secret", body, signature })
    ).resolves.toBe(false)
  })
})
