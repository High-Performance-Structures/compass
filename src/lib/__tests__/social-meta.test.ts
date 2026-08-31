import { afterEach, describe, expect, it, vi } from "vitest"

import { getManagedMetaPages } from "@/lib/social/meta"

vi.mock("server-only", () => ({}))

describe("Meta Page discovery", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("uses the managed Page list when Meta returns it", async () => {
    const requestedUrls: string[] = []
    globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
      requestedUrls.push(input.toString())
      return Response.json({
        data: [{
          id: "page-1",
          name: "Open Range Custom Builders",
          access_token: "page-token",
          instagram_business_account: {
            id: "instagram-1",
            username: "orconstructionltd",
          },
        }],
      })
    }

    await expect(getManagedMetaPages({
      apiVersion: "v25.0",
      appId: "app-id",
      appSecret: "app-secret",
      userAccessToken: "user-token",
    })).resolves.toEqual([{
      pageId: "page-1",
      pageName: "Open Range Custom Builders",
      pageAccessToken: "page-token",
      instagramAccountId: "instagram-1",
      instagramUsername: "orconstructionltd",
    }])
    expect(requestedUrls).toHaveLength(1)
  })

  it("recovers Pages selected by Meta's granular asset picker", async () => {
    const requests: Array<{ readonly url: URL; readonly init?: RequestInit }> = []
    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input.toString())
      requests.push({ url, init })
      if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [] })
      if (url.pathname.endsWith("/debug_token")) {
        return Response.json({
          data: {
            granular_scopes: [
              { scope: "pages_manage_posts", target_ids: ["page-1"] },
              { scope: "pages_read_engagement", target_ids: ["page-1"] },
              { scope: "instagram_content_publish", target_ids: ["instagram-1"] },
            ],
          },
        })
      }
      if (url.pathname.endsWith("/page-1")) {
        return Response.json({
          id: "page-1",
          name: "Open Range Custom Builders",
          access_token: "page-token",
          instagram_business_account: {
            id: "instagram-1",
            username: "orconstructionltd",
          },
        })
      }
      return Response.json({ error: { message: "Unexpected request" } }, { status: 500 })
    }

    await expect(getManagedMetaPages({
      apiVersion: "v25.0",
      appId: "app-id",
      appSecret: "app-secret",
      userAccessToken: "user-token",
    })).resolves.toEqual([{
      pageId: "page-1",
      pageName: "Open Range Custom Builders",
      pageAccessToken: "page-token",
      instagramAccountId: "instagram-1",
      instagramUsername: "orconstructionltd",
    }])
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/v25.0/me/accounts",
      "/v25.0/debug_token",
      "/v25.0/page-1",
    ])
    expect(requests[1]?.init?.headers).toEqual({
      Authorization: "Bearer app-id|app-secret",
    })
  })

  it("returns no candidates when no Page targets were granted", async () => {
    globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [] })
      return Response.json({
        data: {
          granular_scopes: [
            { scope: "instagram_content_publish", target_ids: ["instagram-1"] },
          ],
        },
      })
    }

    await expect(getManagedMetaPages({
      apiVersion: "v25.0",
      appId: "app-id",
      appSecret: "app-secret",
      userAccessToken: "user-token",
    })).resolves.toEqual([])
  })
})
