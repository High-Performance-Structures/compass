import { describe, expect, it } from "vitest"
import {
  canManageListeningTrackLink,
  findPreferredMusicLink,
  formatListeningPosition,
  listeningPlaybackPositionMs,
  musicProviderFromUrl,
  normalizeMusicUrl,
  type MusicProviderLink,
} from "@/lib/listening-room"

describe("listening room provider links", () => {
  it("never substitutes another service for a listener's preference", () => {
    const spotifyLink = {
      provider: "spotify",
    } satisfies MusicProviderLink

    expect(findPreferredMusicLink([spotifyLink], "apple_music")).toBeNull()
    expect(findPreferredMusicLink([spotifyLink], null)).toBeNull()
    expect(findPreferredMusicLink([spotifyLink], "spotify")).toBe(spotifyLink)
  })

  it("recognizes supported music-service hosts without trusting lookalikes", () => {
    expect(musicProviderFromUrl("https://open.spotify.com/track/123")).toBe("spotify")
    expect(musicProviderFromUrl("https://music.apple.com/us/album/example/123")).toBe("apple_music")
    expect(musicProviderFromUrl("https://youtu.be/abc123")).toBe("youtube")
    expect(musicProviderFromUrl("https://m.soundcloud.com/artist/track")).toBe("soundcloud")
    expect(musicProviderFromUrl("https://music.amazon.com/albums/123")).toBe("amazon_music")
    expect(musicProviderFromUrl("https://tidal.com/browse/track/123")).toBe("tidal")
    expect(musicProviderFromUrl("https://spotify.com.example.test/track/123")).toBe("other")
  })

  it("rejects unsafe protocols and credential-bearing links", () => {
    expect(normalizeMusicUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeMusicUrl("https://user:secret@example.com/song")).toBeNull()
    expect(normalizeMusicUrl("not a link")).toBeNull()
  })

  it("removes fragments before storing external service links", () => {
    expect(normalizeMusicUrl("https://example.com/song#private-fragment")).toBe(
      "https://example.com/song"
    )
  })
})

describe("listening room link ownership", () => {
  const baseline = {
    currentUserId: "listener-b",
    trackAddedBy: "listener-a",
    linkAddedBy: "listener-a",
    hostUserId: "host",
    canModerate: false,
  }

  it("prevents an unrelated listener from replacing another listener's link", () => {
    expect(canManageListeningTrackLink(baseline)).toBe(false)
  })

  it("allows the link owner, track contributor, host, or moderator", () => {
    expect(canManageListeningTrackLink({ ...baseline, currentUserId: "listener-a" })).toBe(true)
    expect(canManageListeningTrackLink({ ...baseline, currentUserId: "host" })).toBe(true)
    expect(canManageListeningTrackLink({ ...baseline, canModerate: true })).toBe(true)
  })
})

describe("listening room playback clock", () => {
  it("advances a playing cue from its shared server anchor", () => {
    expect(
      listeningPlaybackPositionMs({
        state: "playing",
        anchorPositionMs: 12_000,
        playbackStartedAt: "2026-09-03T18:00:00.000Z",
        nowMs: Date.parse("2026-09-03T18:00:05.500Z"),
      })
    ).toBe(17_500)
  })

  it("holds paused cues and formats elapsed time", () => {
    const position = listeningPlaybackPositionMs({
      state: "paused",
      anchorPositionMs: 125_000,
      playbackStartedAt: null,
      nowMs: Date.parse("2026-09-03T18:00:05.500Z"),
    })
    expect(position).toBe(125_000)
    expect(formatListeningPosition(position)).toBe("2:05")
  })
})
