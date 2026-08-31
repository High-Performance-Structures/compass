import { afterEach, describe, expect, it, vi } from "vitest"

import { findFacebookAlbumByName } from "@/lib/social/meta"

vi.mock("server-only", () => ({}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("Facebook album discovery", () => {
  it("finds an existing project album across paginated Page albums", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof URL ? input.href : input.toString())
      if (url.searchParams.get("after") === "next-page") {
        return Response.json({
          data: [{ id: "album-modern", name: "  The   Modern Homestead " }],
        })
      }
      return Response.json({
        data: [{ id: "album-other", name: "Another Project" }],
        paging: {
          next: "https://graph.facebook.com/v23.0/page-1/albums?after=next-page",
        },
      })
    })
    globalThis.fetch = fetchMock

    await expect(findFacebookAlbumByName({
      apiVersion: "v23.0",
      pageId: "page-1",
      accessToken: "token",
      name: "The Modern Homestead",
    })).resolves.toEqual({
      id: "album-modern",
      name: "The   Modern Homestead",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns null when the Page has no exact public-title match", async () => {
    globalThis.fetch = vi.fn(async (): Promise<Response> => Response.json({
      data: [{ id: "album-other", name: "Another Project" }],
    }))

    await expect(findFacebookAlbumByName({
      apiVersion: "v23.0",
      pageId: "page-1",
      accessToken: "token",
      name: "The Modern Homestead",
    })).resolves.toBeNull()
  })

  it("rejects an untrusted paging URL returned by Meta", async () => {
    globalThis.fetch = vi.fn(async (): Promise<Response> => Response.json({
      data: [],
      paging: { next: "https://example.com/albums?after=next-page" },
    }))

    await expect(findFacebookAlbumByName({
      apiVersion: "v23.0",
      pageId: "page-1",
      accessToken: "token",
      name: "The Modern Homestead",
    })).rejects.toThrow("invalid album paging URL")
  })
})
