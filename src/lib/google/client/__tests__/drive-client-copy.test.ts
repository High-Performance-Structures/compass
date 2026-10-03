import { afterEach, describe, expect, it, vi } from "vitest"

import { clearCachedToken, setCachedToken } from "@/lib/google/auth/token-cache"
import { DriveClient } from "@/lib/google/client/drive-client"
import type { ServiceAccountKey } from "@/lib/google/config"

const USER_EMAIL = "reviewer@example.com"
const SERVICE_ACCOUNT_KEY: ServiceAccountKey = {
  type: "service_account",
  project_id: "test-project",
  private_key_id: "test-key",
  private_key: "test-private-key",
  client_email: "service@example.com",
  client_id: "test-client",
  auth_uri: "https://accounts.example.test/auth",
  token_uri: "https://accounts.example.test/token",
  auth_provider_x509_cert_url: "https://accounts.example.test/certs",
  client_x509_cert_url: "https://accounts.example.test/client-cert",
  universe_domain: "example.test",
}

function clientWithCachedToken(): DriveClient {
  setCachedToken(USER_EMAIL, "test-access-token", 3600)
  return new DriveClient({ serviceAccountKey: SERVICE_ACCOUNT_KEY })
}

afterEach(() => {
  clearCachedToken(USER_EMAIL)
  vi.unstubAllGlobals()
})

describe("DriveClient copy outcome fencing", () => {
  it.each([429, 500])(
    "does not replay a copy POST after an outcome-ambiguous %i response",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("ambiguous", { status }))
        .mockResolvedValueOnce(
          Response.json({
            id: "duplicate-copy",
            name: "Duplicate copy",
            mimeType: "application/vnd.google-apps.spreadsheet",
          })
        )
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        clientWithCachedToken().copyFile(USER_EMAIL, "template-1", {
          name: "Airlite order",
          parentId: "folder-1",
          idempotencyKey: "generation-fingerprint",
        })
      ).rejects.toThrow("Google Drive copy outcome is unknown")

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const request = fetchMock.mock.calls[0]?.[1]
      expect(new Headers(request?.headers).has("X-Compass-Idempotency-Key")).toBe(false)
    }
  )

  it("preserves an outcome-ambiguous network failure without replaying the copy POST", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket closed"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      clientWithCachedToken().copyFile(USER_EMAIL, "template-1", {
        name: "Airlite order",
        parentId: "folder-1",
        idempotencyKey: "generation-fingerprint",
      })
    ).rejects.toThrow("Google Drive copy outcome is unknown")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("treats an unreadable successful copy response as outcome-ambiguous", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("truncated-json", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          id: "duplicate-copy",
          name: "Duplicate copy",
          mimeType: "application/vnd.google-apps.spreadsheet",
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      clientWithCachedToken().copyFile(USER_EMAIL, "template-1", {
        name: "Airlite order",
        parentId: "folder-1",
        idempotencyKey: "generation-fingerprint",
      })
    ).rejects.toThrow("Google Drive copy outcome is unknown")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: "an empty 204 response",
      response: () => new Response(null, { status: 204 }),
    },
    {
      label: "a 2xx response without a file ID",
      response: () =>
        Response.json({
          name: "Airlite order",
          mimeType: "application/vnd.google-apps.spreadsheet",
        }),
    },
    {
      label: "a 2xx response with an invalid file ID",
      response: () =>
        Response.json({
          id: "",
          name: "Airlite order",
          mimeType: "application/vnd.google-apps.spreadsheet",
        }),
    },
  ])("treats $label as outcome-ambiguous", async ({ response }) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        Response.json({
          id: "duplicate-copy",
          name: "Duplicate copy",
          mimeType: "application/vnd.google-apps.spreadsheet",
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      clientWithCachedToken().copyFile(USER_EMAIL, "template-1", {
        name: "Airlite order",
        parentId: "folder-1",
        idempotencyKey: "generation-fingerprint",
      })
    ).rejects.toThrow("Google Drive copy outcome is unknown")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

})
