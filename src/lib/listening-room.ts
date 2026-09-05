export const MUSIC_PROVIDERS = [
  "spotify",
  "apple_music",
  "youtube",
  "soundcloud",
  "amazon_music",
  "tidal",
  "deezer",
  "pandora",
  "other",
] as const

export const OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID =
  "voice-office-talk-0a72accb-1cd1-4d2d-86d7-88b0e26a8899"

export type MusicProvider = (typeof MUSIC_PROVIDERS)[number]

export type ListeningPlaybackState = "playing" | "paused"

export const LISTENING_ROOM_START_DELAY_MS = 1_500

export const SYNCHRONIZED_MUSIC_PROVIDERS = ["youtube", "soundcloud"] as const
export type SynchronizedMusicProvider =
  (typeof SYNCHRONIZED_MUSIC_PROVIDERS)[number]

export type MusicProviderLink = {
  readonly provider: MusicProvider
}

export type MusicPlaybackTarget = {
  readonly url: string
  readonly kind: "direct" | "search"
}

export function canManageListeningPlaylist(input: {
  readonly currentUserId: string
  readonly createdBy: string
  readonly canModerate: boolean
}): boolean {
  return input.currentUserId === input.createdBy || input.canModerate
}

export function isMusicProvider(value: string): value is MusicProvider {
  return MUSIC_PROVIDERS.some((provider) => provider === value)
}

export function isSynchronizedMusicProvider(
  value: MusicProvider | null
): value is SynchronizedMusicProvider {
  return value === "youtube" || value === "soundcloud"
}

export function synchronizedProviderLabel(
  provider: MusicProvider
): "Synchronized" | "Link only" {
  return isSynchronizedMusicProvider(provider) ? "Synchronized" : "Link only"
}

export function musicProviderLabel(provider: MusicProvider): string {
  switch (provider) {
    case "spotify":
      return "Spotify"
    case "apple_music":
      return "Apple Music"
    case "youtube":
      return "YouTube"
    case "soundcloud":
      return "SoundCloud"
    case "amazon_music":
      return "Amazon Music"
    case "tidal":
      return "TIDAL"
    case "deezer":
      return "Deezer"
    case "pandora":
      return "Pandora"
    case "other":
      return "Other service"
  }
}

export function findPreferredMusicLink<T extends MusicProviderLink>(
  links: readonly T[],
  preferredProvider: MusicProvider | null
): T | null {
  if (preferredProvider === null) return null
  return links.find((link) => link.provider === preferredProvider) ?? null
}

export function musicProviderSearchUrl(input: {
  readonly provider: MusicProvider
  readonly title: string
  readonly artist: string | null
}): string | null {
  const query = [input.title.trim(), input.artist?.trim()]
    .filter((part) => Boolean(part))
    .join(" ")
  if (!query) return null
  const encodedQuery = encodeURIComponent(query)

  switch (input.provider) {
    case "spotify":
      return `https://open.spotify.com/search/${encodedQuery}`
    case "apple_music":
      return `https://music.apple.com/us/search?term=${encodedQuery}`
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encodedQuery}`
    case "soundcloud":
      return `https://soundcloud.com/search?q=${encodedQuery}`
    case "amazon_music":
      return `https://music.amazon.com/search/${encodedQuery}`
    case "tidal":
      return `https://listen.tidal.com/search?q=${encodedQuery}`
    case "deezer":
      return `https://www.deezer.com/search/${encodedQuery}`
    case "pandora":
      return `https://www.pandora.com/search/${encodedQuery}/all`
    case "other":
      return null
  }
}

export function musicPlaybackTarget<T extends MusicProviderLink & { readonly url: string }>(input: {
  readonly links: readonly T[]
  readonly preferredProvider: MusicProvider | null
  readonly title: string
  readonly artist: string | null
}): MusicPlaybackTarget | null {
  if (input.preferredProvider === null) return null
  const directLink = findPreferredMusicLink(
    input.links,
    input.preferredProvider
  )
  if (directLink) return { url: directLink.url, kind: "direct" }

  const searchUrl = musicProviderSearchUrl({
    provider: input.preferredProvider,
    title: input.title,
    artist: input.artist,
  })
  return searchUrl ? { url: searchUrl, kind: "search" } : null
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function normalizeMusicUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export function musicProviderFromUrl(value: string): MusicProvider | null {
  const normalized = normalizeMusicUrl(value)
  if (!normalized) return null

  const hostname = new URL(normalized).hostname.toLowerCase()
  if (hostnameMatches(hostname, "spotify.com")) return "spotify"
  if (hostnameMatches(hostname, "music.apple.com")) return "apple_music"
  if (
    hostnameMatches(hostname, "youtube.com") ||
    hostnameMatches(hostname, "youtu.be")
  ) {
    return "youtube"
  }
  if (hostnameMatches(hostname, "soundcloud.com")) return "soundcloud"
  if (hostnameMatches(hostname, "music.amazon.com")) return "amazon_music"
  if (hostnameMatches(hostname, "tidal.com")) return "tidal"
  if (hostnameMatches(hostname, "deezer.com")) return "deezer"
  if (hostnameMatches(hostname, "pandora.com")) return "pandora"
  return "other"
}

export function youtubeVideoId(value: string): string | null {
  const normalized = normalizeMusicUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  const hostname = url.hostname.toLowerCase()
  let candidate: string | null = null
  if (hostnameMatches(hostname, "youtu.be")) {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null
  } else if (hostnameMatches(hostname, "youtube.com")) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v")
    else {
      const segments = url.pathname.split("/").filter(Boolean)
      if (["embed", "shorts", "live"].includes(segments[0] ?? "")) {
        candidate = segments[1] ?? null
      }
    }
  }
  return candidate && /^[A-Za-z0-9_-]{6,20}$/.test(candidate)
    ? candidate
    : null
}

export function soundCloudTrackUrl(value: string): string | null {
  const normalized = normalizeMusicUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  if (!hostnameMatches(url.hostname.toLowerCase(), "soundcloud.com")) return null
  return url.pathname.split("/").filter(Boolean).length >= 2 ? normalized : null
}

export function listeningPlaybackPositionMs(input: {
  readonly state: ListeningPlaybackState
  readonly anchorPositionMs: number
  readonly playbackStartedAt: string | null
  readonly nowMs?: number
}): number {
  const anchorPositionMs = Math.max(0, Math.trunc(input.anchorPositionMs))
  if (input.state !== "playing" || !input.playbackStartedAt) {
    return anchorPositionMs
  }

  const startedAtMs = Date.parse(input.playbackStartedAt)
  if (!Number.isFinite(startedAtMs)) return anchorPositionMs
  return anchorPositionMs + Math.max(0, (input.nowMs ?? Date.now()) - startedAtMs)
}

export function formatListeningPosition(positionMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function canManageListeningTrackLink(input: {
  readonly currentUserId: string
  readonly trackAddedBy: string
  readonly linkAddedBy: string
  readonly hostUserId: string
  readonly canModerate: boolean
}): boolean {
  return (
    input.currentUserId === input.linkAddedBy ||
    input.currentUserId === input.trackAddedBy ||
    input.currentUserId === input.hostUserId ||
    input.canModerate
  )
}
