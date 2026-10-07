import { describe, expect, it } from "vitest"
import {
  defaultTalkPreferences,
  parseTalkPreferences,
  removeTalkImage,
  talkImageCrop,
  talkPreferencesKey
} from "../talk-preferences"

describe("Talk preferences", () => {
  it("keeps new accounts muted and camera-off", () => {
    expect(defaultTalkPreferences()).toMatchObject({
      joinWithCamera: false,
      joinWithMicrophone: false,
      background: { mode: "none" }
    })
    expect(talkPreferencesKey("one")).not.toBe(talkPreferencesKey("two"))
  })
  it("restores valid preferences and safely resets broken or obsolete storage", () => {
    const saved = {
      ...defaultTalkPreferences(),
      background: { mode: "blur", strength: 65 },
      cameraId: "camera-1"
    }
    expect(parseTalkPreferences(JSON.stringify(saved))).toEqual(saved)
    for (const raw of [
      "bad json",
      JSON.stringify({ ...saved, version: 2 }),
      JSON.stringify({ ...saved, background: { mode: "blur", strength: 200 } })
    ]) {
      expect(parseTalkPreferences(raw)).toEqual(defaultTalkPreferences())
    }
  })
  it("adds standard cleanup to existing v1 choices without losing personal images or devices", () => {
    const saved = {
      version: 1,
      background: { mode: "image", imageId: "personal" },
      images: [
        { id: "personal", name: "Office", url: "data:image/jpeg;base64,YQ==" }
      ],
      cameraId: "camera-1",
      microphoneId: "mic-1",
      speakerId: "speaker-1",
      joinWithCamera: true,
      joinWithMicrophone: false
    }
    expect(parseTalkPreferences(JSON.stringify(saved))).toEqual({
      ...saved,
      backgroundCleanup: "standard"
    })
    expect(
      parseTalkPreferences(
        JSON.stringify({ ...saved, backgroundCleanup: "strong" })
      )
    ).toEqual({ ...saved, backgroundCleanup: "strong" })
  })
  it("does not restore arbitrary URLs or missing personal images", () => {
    const saved = {
      ...defaultTalkPreferences(),
      background: { mode: "image", imageId: "missing" }
    }
    expect(parseTalkPreferences(JSON.stringify(saved)).background).toEqual({
      mode: "none"
    })
    expect(
      parseTalkPreferences(
        JSON.stringify({
          ...saved,
          images: [
            {
              id: "missing",
              name: "Unsafe",
              url: "https://example.com/private"
            }
          ]
        })
      )
    ).toEqual(defaultTalkPreferences())
  })
  it("removes the selected image and clears its stored selection", () => {
    const image = {
      id: "custom",
      name: "My image",
      url: "data:image/jpeg;base64,YQ=="
    }
    const preferences = parseTalkPreferences(
      JSON.stringify({
        ...defaultTalkPreferences(),
        images: [image],
        background: { mode: "image", imageId: "custom" }
      })
    )
    expect(removeTalkImage(preferences, "custom")).toMatchObject({
      images: [],
      background: { mode: "none" }
    })
    expect(preferences.images).toHaveLength(1)
  })
  it("keeps wide and tall crops inside the image at every control extreme", () => {
    for (const [width, height] of [
      [400, 900],
      [2400, 800],
      [1600, 900]
    ]) {
      for (const zoom of [1, 3])
        for (const x of [0, 100])
          for (const y of [0, 100]) {
            const crop = talkImageCrop(width, height, zoom, x, y)
            expect(crop.width / crop.height).toBeCloseTo(16 / 9)
            expect(crop.x).toBeGreaterThanOrEqual(0)
            expect(crop.y).toBeGreaterThanOrEqual(0)
            expect(crop.x + crop.width).toBeLessThanOrEqual(width)
            expect(crop.y + crop.height).toBeLessThanOrEqual(height)
          }
    }
  })
})
