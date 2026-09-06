import { describe, expect, it } from "vitest"
import {
  canManageListeningPlaylist,
  canManageListeningTrackLink,
  findPreferredMusicLink,
  findMatchingPlaylistRun,
  formatListeningPosition,
  listeningPlaybackPositionMs,
  musicPlaybackTarget,
  musicProviderFromUrl,
  musicProviderSearchUrl,
  normalizeMusicUrl,
  soundCloudTrackUrl,
  synchronizedProviderLabel,
  youtubeVideoId,
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

  it("builds a service search when an exact provider link is unavailable", () => {
    expect(
      musicProviderSearchUrl({
        provider: "apple_music",
        title: "Dreams",
        artist: "Fleetwood Mac",
      })
    ).toBe("https://music.apple.com/us/search?term=Dreams%20Fleetwood%20Mac")
    expect(
      musicPlaybackTarget({
        links: [{ provider: "spotify", url: "https://open.spotify.com/track/123" }],
        preferredProvider: "apple_music",
        title: "Dreams",
        artist: "Fleetwood Mac",
      })
    ).toEqual({
      url: "https://music.apple.com/us/search?term=Dreams%20Fleetwood%20Mac",
      kind: "search",
    })
  })

  it("prefers an exact service link and does not guess an unknown service", () => {
    expect(
      musicPlaybackTarget({
        links: [{ provider: "apple_music", url: "https://music.apple.com/song/123" }],
        preferredProvider: "apple_music",
        title: "Dreams",
        artist: null,
      })
    ).toEqual({ url: "https://music.apple.com/song/123", kind: "direct" })
    expect(
      musicProviderSearchUrl({
        provider: "other",
        title: "Dreams",
        artist: "Fleetwood Mac",
      })
    ).toBeNull()
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

  it("extracts embeddable YouTube video IDs", () => {
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=12")).toBe("dQw4w9WgXcQ")
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeVideoId("https://youtube.example/watch?v=dQw4w9WgXcQ")).toBeNull()
  })

  it("accepts track-level SoundCloud URLs and labels sync capability", () => {
    expect(soundCloudTrackUrl("https://soundcloud.com/artist/track")).toBe(
      "https://soundcloud.com/artist/track"
    )
    expect(soundCloudTrackUrl("https://soundcloud.com/artist")).toBeNull()
    expect(synchronizedProviderLabel("youtube")).toBe("Synchronized")
    expect(synchronizedProviderLabel("spotify")).toBe("Link only")
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

describe("listening room playlist ownership", () => {
  it("lets the creator or a channel moderator edit a saved playlist", () => {
    expect(canManageListeningPlaylist({
      currentUserId: "user-a",
      createdBy: "user-a",
      canModerate: false,
    })).toBe(true)
    expect(canManageListeningPlaylist({
      currentUserId: "moderator",
      createdBy: "user-a",
      canModerate: true,
    })).toBe(true)
  })

  it("keeps unrelated listeners from editing another person's playlist", () => {
    expect(canManageListeningPlaylist({
      currentUserId: "user-b",
      createdBy: "user-a",
      canModerate: false,
    })).toBe(false)
  })
})

describe("listening room saved playlist matching", () => {
  const songA = {
    title: "Song A",
    artist: "Artist",
    links: [{ provider: "youtube", url: "https://youtu.be/song-a" }],
  }
  const songB = {
    title: "Song B",
    artist: "Artist",
    links: [{ provider: "youtube", url: "https://youtu.be/song-b" }],
  }

  it("reuses a complete ordered playlist run", () => {
    expect(findMatchingPlaylistRun([songA, songB], [songA, songB])).toBe(0)
    expect(findMatchingPlaylistRun([songB, songA, songB], [songA, songB])).toBe(1)
  })

  it("does not treat one matching song as the whole playlist", () => {
    expect(findMatchingPlaylistRun([songA], [songA, songB])).toBeNull()
    expect(findMatchingPlaylistRun([songA, songB], [songB, songA])).toBeNull()
  })
})
