"use server"

import { z } from "zod/v4"
import { getCurrentUser } from "@/lib/auth"
import {
  isSynchronizedMusicProvider,
  musicProviderFromUrl,
  normalizeMusicUrl,
  songDetailsFromEmbed,
} from "@/lib/listening-room"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

const oEmbedSchema = z.object({
  title: z.string().min(1),
  author_name: z.string().optional(),
})

export type ListeningTrackLookup = {
  readonly title: string
  readonly artist: string | null
}

// Only the providers' own oEmbed endpoints are contacted, never the pasted URL.
const OEMBED_ENDPOINTS = {
  youtube: "https://www.youtube.com/oembed?format=json&url=",
  soundcloud: "https://soundcloud.com/oembed?format=json&url=",
} as const

export async function lookupListeningTrack(
  url: string
): Promise<
  | { readonly success: true; readonly data: ListeningTrackLookup }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user || !can(user, "channels", "read") || !isInternalStaffRole(user.role)) {
    return { success: false, error: "Unauthorized" }
  }
  const normalized = z.string().trim().max(2_048).safeParse(url)
  const normalizedUrl = normalized.success ? normalizeMusicUrl(normalized.data) : null
  const provider = normalizedUrl ? musicProviderFromUrl(normalizedUrl) : null
  if (!normalizedUrl || !isSynchronizedMusicProvider(provider)) {
    return { success: false, error: "Paste a YouTube or SoundCloud link" }
  }
  try {
    const response = await fetch(
      `${OEMBED_ENDPOINTS[provider]}${encodeURIComponent(normalizedUrl)}`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!response.ok) {
      return { success: false, error: "We couldn't find that song. Check the link." }
    }
    const parsed = oEmbedSchema.safeParse(await response.json())
    if (!parsed.success) {
      return { success: false, error: "We couldn't read the song name from that link" }
    }
    return {
      success: true,
      data: songDetailsFromEmbed({
        provider,
        title: parsed.data.title,
        authorName: parsed.data.author_name ?? null,
      }),
    }
  } catch {
    return { success: false, error: "We couldn't reach the music service. Type the song name instead." }
  }
}
