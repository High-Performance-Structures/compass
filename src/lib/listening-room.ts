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

export type MusicProvider = (typeof MUSIC_PROVIDERS)[number]

export type ListeningPlaybackState = "playing" | "paused"

export function isMusicProvider(value: string): value is MusicProvider {
  return MUSIC_PROVIDERS.some((provider) => provider === value)
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
