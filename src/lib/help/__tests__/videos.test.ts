import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { getHelpGuides, getHelpTopic } from "@/lib/help"
import {
  HELP_VIDEOS,
  getHelpVideo,
  getHelpVideosForGuide,
  helpVideoUrl,
} from "@/lib/help/videos"
import { getHelpTopicLocation } from "@/lib/help/topics"

describe("help tutorial videos", () => {
  it("resolves topics from the light index exactly like the full guides", () => {
    for (const guide of getHelpGuides()) {
      expect(getHelpTopicLocation(guide.id)).toEqual({
        guideId: guide.id,
        guideSlug: guide.slug,
        sectionId: null,
      })
      for (const section of guide.sections) {
        expect(getHelpTopicLocation(section.topicId), section.topicId).toEqual({
          guideId: getHelpTopic(section.topicId)?.guide.id,
          guideSlug: guide.slug,
          sectionId: getHelpTopic(section.topicId)?.section?.id,
        })
      }
    }
    expect(getHelpTopicLocation("not-a-topic")).toBeNull()
    expect(getHelpTopicLocation("constructor")).toBeNull()
  })

  it("keeps the video module off the full guide registry", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/help/videos.ts"), "utf8")
    expect(source).not.toContain('from "@/lib/help"')
    expect(source).not.toContain("help-guides.generated")
  })

  it("attaches every video to an existing guide section", () => {
    for (const video of HELP_VIDEOS) {
      expect(getHelpTopic(video.topicId)?.section, video.topicId).toBeTruthy()
    }
  })

  it("has unique, URL-safe IDs and at most one video per section", () => {
    const ids = HELP_VIDEOS.map((video) => video.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    const topics = HELP_VIDEOS.map((video) => video.topicId)
    expect(new Set(topics).size).toBe(topics.length)
  })

  it("has a recording script for every video", () => {
    for (const video of HELP_VIDEOS) {
      const script = resolve(process.cwd(), "scripts/help-videos/clips", `${video.id}.mjs`)
      expect(existsSync(script), script).toBe(true)
    }
  })

  it("keeps clips short", () => {
    for (const video of HELP_VIDEOS) {
      expect(video.durationSeconds).toBeGreaterThan(0)
      expect(video.durationSeconds).toBeLessThanOrEqual(90)
    }
  })

  it("resolves a video's guide for access checks", () => {
    const video = getHelpVideo("daily-logs-create")
    expect(video?.guideId).toBe(getHelpTopic("daily.logs.create-log")?.guide.id)
    expect(getHelpVideo("not-a-video")).toBeNull()
    expect(helpVideoUrl("daily-logs-create")).toBe("/api/help/videos/daily-logs-create")
  })

  it("groups videos under their section within a guide", () => {
    const guide = getHelpTopic("daily.logs.create-log")?.guide
    expect(guide).toBeTruthy()
    const videos = getHelpVideosForGuide(guide?.id ?? "")
    expect(videos["create-log"]?.id).toBe("daily-logs-create")
  })

  // Guides with videos render section by section, so the sections must
  // rebuild the original guide text exactly.
  it("can render every guide section by section without losing text", () => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim()
    for (const guide of getHelpGuides()) {
      const rebuilt = guide.sections
        .map((section) => `## ${section.title}\n${section.content}`)
        .join("\n\n")
      expect(normalize(rebuilt), guide.slug).toBe(normalize(guide.content))
    }
  })
})
