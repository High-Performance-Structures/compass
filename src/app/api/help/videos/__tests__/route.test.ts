import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveHelpGuideAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/help/server-access", () => ({
  getEffectiveHelpGuideAccess: mocks.getEffectiveHelpGuideAccess,
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { GET } from "../[videoId]/route"
import { getHelpVideo } from "@/lib/help/videos"

const VIDEO_ID = "daily-logs-create"
const BYTES = new Uint8Array(100).map((_, index) => index)

function bucketWithVideo() {
  return {
    get: vi.fn(async (key: string, options: { range: Headers }) => {
      if (key !== `${VIDEO_ID}.mp4`) return null
      const header = options.range.get("range")
      const match = header ? /bytes=(\d+)-(\d+)/.exec(header) : null
      const offset = match ? Number(match[1]) : 0
      const length = match ? Number(match[2]) - offset + 1 : BYTES.length
      return {
        body: new Blob([BYTES.slice(offset, offset + length)]).stream(),
        size: BYTES.length,
        httpEtag: '"etag"',
        range: match ? { offset, length } : undefined,
      }
    }),
  }
}

function request(range?: string): NextRequest {
  return new NextRequest(`http://localhost/api/help/videos/${VIDEO_ID}`, {
    headers: range ? { range } : {},
  })
}

function call(videoId: string, range?: string): Promise<Response> {
  return GET(request(range), { params: Promise.resolve({ videoId }) })
}

function allowGuide(allowed: boolean): void {
  const guideId = getHelpVideo(VIDEO_ID)?.guideId ?? ""
  mocks.getEffectiveHelpGuideAccess.mockResolvedValue({
    canViewHelp: true,
    allowedGuideIds: allowed ? [guideId] : [],
  })
}

afterEach(() => vi.clearAllMocks())

describe("help video route", () => {
  it("streams a video the viewer's guide access allows", async () => {
    allowGuide(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { HELP_VIDEOS: bucketWithVideo() } })
    const response = await call(VIDEO_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("video/mp4")
    expect(response.headers.get("Cache-Control")).toContain("private")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it("answers range requests so the player can seek", async () => {
    allowGuide(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { HELP_VIDEOS: bucketWithVideo() } })
    const response = await call(VIDEO_ID, "bytes=10-19")
    expect(response.status).toBe(206)
    expect(response.headers.get("Content-Range")).toBe("bytes 10-19/100")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES.slice(10, 20))
  })

  it("hides videos from guides the viewer can't read", async () => {
    allowGuide(false)
    const bucket = bucketWithVideo()
    mocks.getCloudflareContext.mockResolvedValue({ env: { HELP_VIDEOS: bucket } })
    const response = await call(VIDEO_ID)
    expect(response.status).toBe(404)
    expect(bucket.get).not.toHaveBeenCalled()
  })

  it("treats unknown videos exactly like forbidden ones", async () => {
    allowGuide(true)
    const response = await call("not-a-video")
    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Video not found")
    expect(mocks.getEffectiveHelpGuideAccess).not.toHaveBeenCalled()
  })

  it("reports videos as unavailable where the bucket isn't configured", async () => {
    allowGuide(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: {} })
    expect((await call(VIDEO_ID)).status).toBe(404)
  })
})
